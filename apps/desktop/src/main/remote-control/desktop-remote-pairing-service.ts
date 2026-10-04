import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import type { RemoteConnectionState } from "@567agent/remote-control";
import type { RemotePairingState } from "../../preload/api-types/remote-pairing.js";
import { type DesktopConfig, readDesktopConfig, updateDesktopConfig } from "../config/desktop-config-store.js";
import type { CredentialVault } from "../credentials/credential-vault.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import { getDesktopLocalRelay } from "./desktop-local-relay.js";
import {
	createDesktopLocalRelayCertificate,
	type DesktopLocalRelayCertificate,
} from "./desktop-local-relay-certificate.js";
import { startDesktopRemoteAccess, stopDesktopRemoteAccess } from "./desktop-remote-access-service.js";
import {
	type DesktopRemoteDesktopHostHandle,
	startDesktopRemoteDesktopHost,
	stopDesktopRemoteDesktopHost,
} from "./desktop-remote-desktop-host.js";

const log = getAppLogger("remote-pairing");
const CREDENTIAL_NAMESPACE = "remote-control";
const CREDENTIAL_OWNER = "desktop";
const CREDENTIAL_NAME = "desktop-secret";
const LOCAL_RELAY_CERT_CREDENTIAL = "local-relay-tls";
const MOBILE_RESUME_CREDENTIAL = "mobile-resume-secret";

export interface DesktopRemotePairingServiceOptions {
	readonly appRoot: string;
	readonly isPackaged: boolean;
	readonly devServerUrl?: string;
	readonly conversationCwd: string;
	readonly defaultRelayBaseUrl?: string;
}

export interface DesktopRemotePairingState {
	readonly status: "idle" | "ready" | "connected" | "error";
	readonly relayBaseUrl?: string;
	readonly pairingId?: string;
	readonly inviteUri?: string;
	readonly inputEnabled: boolean;
	readonly inputSupported: boolean;
	readonly inputSupportReason?: RemotePairingState["inputSupportReason"];
	readonly error?: string;
}

export class DesktopRemotePairingService {
	private readonly vault: Pick<CredentialVault, "isAvailable" | "get" | "put" | "remove">;
	private state: DesktopRemotePairingState = {
		status: "idle",
		inputEnabled: false,
		inputSupported: false,
	};
	private host: DesktopRemoteDesktopHostHandle | undefined;
	private localRelayCertificate: DesktopLocalRelayCertificate | undefined;
	private connectionState: RemoteConnectionState = "idle";

	constructor(
		private readonly options: DesktopRemotePairingServiceOptions,
		vault: Pick<CredentialVault, "isAvailable" | "get" | "put" | "remove"> = getDesktopCredentialVault(),
	) {
		this.vault = vault;
	}

	getState(): DesktopRemotePairingState {
		return { ...this.state };
	}

	async restore(): Promise<void> {
		const config = await readDesktopConfig();
		const remote = config.remoteControl;
		let secret: string | undefined;
		try {
			secret = this.readDesktopSecret();
		} catch (error) {
			const message = "Saved remote pairing credentials could not be decrypted; create a new pairing.";
			this.state = {
				status: "error",
				inputEnabled: remote?.inputEnabled === true,
				inputSupported: false,
				error: message,
			};
			log.warn("remote pairing credentials could not be restored; stored data was preserved", {
				error: error instanceof Error ? error.message : String(error),
			});
			return;
		}
		if (!remote?.pairingId || !remote.relayBaseUrl || !secret) return;
		this.state = {
			status: "ready",
			relayBaseUrl: remote.relayBaseUrl,
			pairingId: remote.pairingId,
			inputEnabled: remote.inputEnabled === true,
			inputSupported: false,
		};
		try {
			const localRelay = getDesktopLocalRelay();
			this.localRelayCertificate = await this.getLocalRelayCertificate(localRelay.getLanIp());
			await localRelay.start(this.localRelayCertificate, {
				pairingId: remote.pairingId,
				desktopSecret: secret,
				resumeSecret: this.readMobileResumeSecret(),
				onResumeSecret: (resumeSecret) => this.storeMobileResumeSecret(resumeSecret),
			});
			const activeUrl = localRelay.getLanUrl();
			await this.startActive(
				activeUrl,
				remote.pairingId,
				secret,
				remote.inputEnabled === true,
				undefined,
				this.localRelayCertificate,
				normalizeRelayBaseUrl(remote.relayBaseUrl),
			);
			this.state = {
				...this.state,
				status: this.connectionState === "online" ? "connected" : this.state.status,
				inputEnabled: remote.inputEnabled === true && this.host?.inputSupported === true,
				inputSupported: this.host?.inputSupported === true,
				inputSupportReason: this.host?.inputSupportReason,
			};
			log.info("remote pairing restored", { pairingId: remote.pairingId });
		} catch (error) {
			this.state = {
				status: "error",
				inputEnabled: remote.inputEnabled === true,
				inputSupported: false,
				error: error instanceof Error ? error.message : String(error),
			};
			log.warn("remote pairing restore failed", { error: this.state.error });
		}
	}

	async create(relayBaseUrl?: string): Promise<DesktopRemotePairingState> {
		const relay = normalizeRelayBaseUrl(relayBaseUrl ?? this.options.defaultRelayBaseUrl);
		if (!relay) throw new Error("请输入有效的中继地址");
		if (!this.vault.isAvailable()) throw new Error("当前系统无法使用安全凭据存储");
		await this.revoke(false);
		const pairingId = randomBytes(24).toString("base64url");
		const desktopSecret = randomBytes(32).toString("base64url");
		const bootstrapSecret = randomBytes(32).toString("base64url");
		this.vault.put(
			{ namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: CREDENTIAL_NAME },
			desktopSecret,
			{ kind: "remote-desktop", consumer: "desktop" },
		);
		const localRelay = getDesktopLocalRelay();
		this.localRelayCertificate = await this.getLocalRelayCertificate(localRelay.getLanIp(), true);
		await localRelay.start(this.localRelayCertificate, {
			pairingId,
			desktopSecret,
			bootstrapSecret,
			onResumeSecret: (resumeSecret) => this.storeMobileResumeSecret(resumeSecret),
		});
		const lanUrl = localRelay.getLanUrl();
		await this.persistRemoteConfig({ relayBaseUrl: relay, pairingId, inputEnabled: false });
		await this.startActive(
			lanUrl,
			pairingId,
			desktopSecret,
			false,
			bootstrapSecret,
			this.localRelayCertificate,
			relay,
		);
		this.state = {
			status: "ready",
			relayBaseUrl: relay,
			pairingId,
			inviteUri: buildInviteUri(relay, pairingId, bootstrapSecret, lanUrl, this.localRelayCertificate.fingerprint),
			inputEnabled: false,
			inputSupported: this.host?.inputSupported === true,
			inputSupportReason: this.host?.inputSupportReason,
		};
		log.info("remote pairing created", { pairingId, host: hostname() });
		return this.getState();
	}

	async setInputEnabled(enabled: boolean): Promise<DesktopRemotePairingState> {
		const effective = enabled && this.host?.inputSupported === true;
		if (effective) this.host?.grantInput();
		else this.host?.revokeInput();
		this.state = { ...this.state, inputEnabled: effective };
		await this.persistRemoteConfig({ inputEnabled: effective });
		return this.getState();
	}

	async revoke(clearCredential = true): Promise<void> {
		await stopDesktopRemoteAccess();
		await stopDesktopRemoteDesktopHost();
		await getDesktopLocalRelay().stop();
		this.host = undefined;
		this.connectionState = "idle";
		this.vault.remove({ namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: MOBILE_RESUME_CREDENTIAL });
		if (clearCredential)
			this.vault.remove({ namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: CREDENTIAL_NAME });
		await updateDesktopConfig((config) => (config.remoteControl ? { ...config, remoteControl: undefined } : config));
		this.state = { status: "idle", inputEnabled: false, inputSupported: false };
		log.info("remote pairing revoked");
	}

	private async startActive(
		relay: string,
		pairingId: string,
		desktopSecret: string,
		inputEnabled: boolean,
		bootstrapSecret?: string,
		localRelayCertificate?: DesktopLocalRelayCertificate,
		cloudRelay?: string,
	): Promise<void> {
		const cloudParams = new URLSearchParams({
			pairing: desktopSecret,
			...(bootstrapSecret ? { bootstrap: bootstrapSecret } : {}),
		});
		const lanParams = new URLSearchParams(cloudParams);
		if (localRelayCertificate) lanParams.set("fingerprint", localRelayCertificate.fingerprint);
		const controlTargets = [
			...(cloudRelay ? [{ target: `${cloudRelay}/v1/relay/${pairingId}/desktop#${cloudParams.toString()}` }] : []),
			{
				target: `${relay}/v1/relay/${pairingId}/desktop#${lanParams.toString()}`,
				webSocketCaCertificate: localRelayCertificate?.certificate,
			},
		];
		const signalingTargets = [
			...(cloudRelay ? [`${cloudRelay}/v1/desktop/${pairingId}/host#${cloudParams.toString()}`] : []),
			`${relay}/v1/desktop/${pairingId}/host#${lanParams.toString()}`,
		];
		await startDesktopRemoteAccess({
			controlTargets,
			conversationCwd: this.options.conversationCwd,
			onStateChange: (state) => this.handleConnectionState(state),
		});
		this.host = await startDesktopRemoteDesktopHost({
			signalingTargets,
			inputEnabled,
			appRoot: this.options.appRoot,
			isPackaged: this.options.isPackaged,
			devServerUrl: this.options.devServerUrl,
		});
	}

	private handleConnectionState(state: RemoteConnectionState): void {
		this.connectionState = state;
		if (state === "online") {
			this.state = { ...this.state, status: "connected", error: undefined };
			return;
		}
		if (state === "connecting" || state === "reconnecting" || state === "recovering") {
			this.state = { ...this.state, status: "ready", error: undefined };
			return;
		}
		if (state === "failed") {
			this.state = { ...this.state, status: "error", error: "远程连接失败" };
		}
	}

	private readDesktopSecret(): string | undefined {
		return this.vault.get({ namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: CREDENTIAL_NAME });
	}

	private async persistRemoteConfig(patch: NonNullable<DesktopConfig["remoteControl"]>): Promise<void> {
		await updateDesktopConfig((config) => {
			return { ...config, remoteControl: { ...config.remoteControl, ...patch } };
		});
	}

	private async getLocalRelayCertificate(ipAddress: string, rotate = false): Promise<DesktopLocalRelayCertificate> {
		const ref = { namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: LOCAL_RELAY_CERT_CREDENTIAL };
		const stored = rotate ? undefined : this.vault.get(ref);
		if (stored) {
			try {
				const parsed = JSON.parse(stored) as DesktopLocalRelayCertificate;
				if (parsed.certificate && parsed.privateKey && parsed.fingerprint) return parsed;
			} catch {
				// Replace malformed local relay credentials with a fresh certificate.
			}
		}
		const generated = await createDesktopLocalRelayCertificate(ipAddress);
		this.vault.put(ref, JSON.stringify(generated), { kind: "remote-relay-tls", consumer: "desktop" });
		return generated;
	}

	private readMobileResumeSecret(): string | undefined {
		return this.vault.get({
			namespace: CREDENTIAL_NAMESPACE,
			ownerId: CREDENTIAL_OWNER,
			name: MOBILE_RESUME_CREDENTIAL,
		});
	}

	private storeMobileResumeSecret(secret: string): void {
		this.vault.put(
			{ namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: MOBILE_RESUME_CREDENTIAL },
			secret,
			{ kind: "remote-mobile-resume", consumer: "desktop-local-relay" },
		);
	}
}

function normalizeRelayBaseUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const parsed = new URL(value.trim());
		if (parsed.protocol !== "https:" && parsed.protocol !== "wss:") return undefined;
		const protocol = parsed.protocol === "https:" ? "wss:" : parsed.protocol;
		return `${protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
	} catch {
		return undefined;
	}
}

function buildInviteUri(
	relay: string,
	pairingId: string,
	bootstrap: string,
	lanUrl?: string,
	lanFingerprint?: string,
): string {
	const webRelay = relay.replace(/^ws/, "http");
	const params = new URLSearchParams({
		relay: webRelay,
		pairingId,
		bootstrap,
		...(lanUrl ? { lan: lanUrl } : {}),
		...(lanFingerprint ? { lanFingerprint } : {}),
	});
	return `agent567://pair?${params.toString()}`;
}
