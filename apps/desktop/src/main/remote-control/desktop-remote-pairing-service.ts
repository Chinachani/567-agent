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
	isDesktopLocalRelayCertificateAuthority,
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
	readonly autoShareScreen: boolean;
	readonly inputEnabled: boolean;
	readonly inputPermissionEnabled?: boolean;
	readonly inputSupported: boolean;
	readonly inputSupportReason?: RemotePairingState["inputSupportReason"];
	readonly pairingWarnings?: RemotePairingState["pairingWarnings"];
	readonly error?: string;
}

export class DesktopRemotePairingService {
	private readonly vault: Pick<CredentialVault, "isAvailable" | "get" | "put" | "remove">;
	private state: DesktopRemotePairingState = {
		status: "idle",
		autoShareScreen: false,
		inputEnabled: false,
		inputSupported: false,
	};
	private host: DesktopRemoteDesktopHostHandle | undefined;
	private localRelayCertificate: DesktopLocalRelayCertificate | undefined;
	private certificateChangedForUpgrade = false;
	private connectionState: RemoteConnectionState = "idle";

	constructor(
		private readonly options: DesktopRemotePairingServiceOptions,
		vault: Pick<CredentialVault, "isAvailable" | "get" | "put" | "remove"> = getDesktopCredentialVault(),
	) {
		this.vault = vault;
	}

	getState(): DesktopRemotePairingState {
		return {
			...this.state,
			inputPermissionEnabled: this.state.inputEnabled,
			inputSupported: this.host?.inputSupported === true,
			inputEnabled: this.state.inputEnabled && this.host?.inputSupported === true,
			inputSupportReason: this.host?.inputSupportReason ?? this.state.inputSupportReason,
		};
	}

	async restore(): Promise<void> {
		const config = await readDesktopConfig();
		const remote = config.remoteControl;
		const relay = normalizeRelayBaseUrl(remote?.relayBaseUrl);
		let secret: string | undefined;
		try {
			secret = this.readDesktopSecret();
		} catch (error) {
			const message = "Saved remote pairing credentials could not be decrypted; create a new pairing.";
			this.state = {
				status: "error",
				autoShareScreen: remote?.autoShareScreen === true,
				inputEnabled: remote?.inputEnabled === true,
				inputSupported: false,
				error: message,
			};
			log.warn("remote pairing credentials could not be restored; stored data was preserved", {
				error: error instanceof Error ? error.message : String(error),
			});
			return;
		}
		if (!remote?.pairingId || !relay || !secret) return;
		this.state = {
			status: "ready",
			relayBaseUrl: relay,
			pairingId: remote.pairingId,
			autoShareScreen: remote.autoShareScreen === true,
			inputEnabled: remote.inputEnabled === true,
			inputSupported: false,
		};
		try {
			const localRelay = getDesktopLocalRelay();
			const lanIp = localRelay.getLanIp();
			this.localRelayCertificate = await this.getLocalRelayCertificate(lanIp);
			this.state = {
				...this.state,
				pairingWarnings: [
					...(this.certificateChangedForUpgrade ? ["certificate_changed" as const] : []),
					...(lanIp === "127.0.0.1" ? ["lan_unavailable" as const] : []),
				],
			};
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
				relay,
				remote.autoShareScreen === true,
			);
			if (remote.relayBaseUrl !== relay) {
				await this.persistRemoteConfig({ relayBaseUrl: relay });
			}
			this.state = {
				...this.state,
				status: this.connectionState === "online" ? "connected" : this.state.status,
				// Keep the user's persisted permission preference even while no
				// capture source is selected; getState derives the effective value.
				inputEnabled: remote.inputEnabled === true,
				autoShareScreen: remote.autoShareScreen === true,
				inputSupported: this.host?.inputSupported === true,
				inputSupportReason: this.host?.inputSupportReason,
			};
			log.info("remote pairing restored", { pairingId: remote.pairingId });
		} catch (error) {
			this.state = {
				status: "error",
				autoShareScreen: remote.autoShareScreen === true,
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
		this.certificateChangedForUpgrade = false;
		const pairingId = randomBytes(24).toString("base64url");
		const desktopSecret = randomBytes(32).toString("base64url");
		const bootstrapSecret = randomBytes(32).toString("base64url");
		this.vault.put(
			{ namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: CREDENTIAL_NAME },
			desktopSecret,
			{ kind: "remote-desktop", consumer: "desktop" },
		);
		const localRelay = getDesktopLocalRelay();
		const lanIp = localRelay.getLanIp();
		// Keep the local relay identity stable across pairing resets. Mobile clients
		// pin this certificate fingerprint; rotating it here strands saved pairings.
		this.localRelayCertificate = await this.getLocalRelayCertificate(lanIp);
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
			false,
		);
		this.state = {
			status: "ready",
			relayBaseUrl: relay,
			pairingId,
			inviteUri: buildInviteUri(relay, pairingId, bootstrapSecret, lanUrl, this.localRelayCertificate.fingerprint),
			autoShareScreen: false,
			inputEnabled: false,
			inputSupported: this.host?.inputSupported === true,
			inputSupportReason: this.host?.inputSupportReason,
			pairingWarnings: [
				...(this.certificateChangedForUpgrade ? (["certificate_changed"] as const) : []),
				...(lanIp === "127.0.0.1" ? (["lan_unavailable"] as const) : []),
			],
		};
		log.info("remote pairing created", { pairingId, host: hostname() });
		return this.getState();
	}

	async resetCertificate(relayBaseUrl?: string): Promise<DesktopRemotePairingState> {
		const relay = normalizeRelayBaseUrl(relayBaseUrl ?? this.options.defaultRelayBaseUrl);
		if (!relay) throw new Error("请输入有效的中继地址");
		if (!this.vault.isAvailable()) throw new Error("当前系统无法使用安全凭据存储");
		await this.revoke();
		this.vault.remove({
			namespace: CREDENTIAL_NAMESPACE,
			ownerId: CREDENTIAL_OWNER,
			name: LOCAL_RELAY_CERT_CREDENTIAL,
		});
		this.certificateChangedForUpgrade = false;
		log.info("local relay certificate reset by user");
		return this.create(relay);
	}

	async setInputEnabled(enabled: boolean): Promise<DesktopRemotePairingState> {
		const effective = enabled && this.host?.inputSupported === true;
		if (effective) this.host?.grantInput();
		else this.host?.revokeInput();
		this.state = { ...this.state, inputEnabled: effective };
		await this.persistRemoteConfig({ inputEnabled: effective });
		return this.getState();
	}

	async setAutoShareScreen(enabled: boolean): Promise<DesktopRemotePairingState> {
		if (!this.state.pairingId) throw new Error("请先配对手机");
		this.host?.setAutoShareScreen(enabled);
		await this.persistRemoteConfig({ autoShareScreen: enabled });
		this.state = { ...this.state, autoShareScreen: enabled };
		log.info("remote screen auto-share preference changed", { enabled });
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
		this.state = { status: "idle", autoShareScreen: false, inputEnabled: false, inputSupported: false };
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
		autoShareScreen = false,
	): Promise<void> {
		const cloudParams = new URLSearchParams({
			pairing: desktopSecret,
			...(bootstrapSecret ? { bootstrap: bootstrapSecret } : {}),
		});
		const lanParams = new URLSearchParams(cloudParams);
		if (localRelayCertificate) lanParams.set("fingerprint", localRelayCertificate.fingerprint);
		const lanWebSocketRelay = toWebSocketBaseUrl(relay);
		const cloudWebSocketRelay = cloudRelay ? toWebSocketBaseUrl(cloudRelay) : undefined;
		const controlTargets = [
			...(cloudWebSocketRelay
				? [
						{
							target: `${cloudWebSocketRelay}/v1/relay/${pairingId}/desktop#${cloudParams.toString()}`,
							allowSessionMigrationTransfer: false,
						},
					]
				: []),
			{
				target: `${lanWebSocketRelay}/v1/relay/${pairingId}/desktop#${lanParams.toString()}`,
				webSocketCaCertificate: localRelayCertificate?.certificate,
				allowSessionMigrationTransfer: Boolean(localRelayCertificate?.certificate),
			},
		];
		const signalingTargets = [
			...(cloudWebSocketRelay
				? [`${cloudWebSocketRelay}/v1/desktop/${pairingId}/host#${cloudParams.toString()}`]
				: []),
			`${lanWebSocketRelay}/v1/desktop/${pairingId}/host#${lanParams.toString()}`,
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
			autoShareScreen,
			onAutoShareScreenChange: async (enabled) => {
				await this.persistRemoteConfig({ autoShareScreen: enabled });
				this.state = { ...this.state, autoShareScreen: enabled };
			},
			onInputCapabilityChange: (supported, reason) => {
				if (supported && this.state.inputEnabled) this.host?.grantInput();
				else if (!supported) this.host?.revokeInput();
				this.state = {
					...this.state,
					inputSupported: supported,
					inputSupportReason: reason,
				};
			},
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

	private async getLocalRelayCertificate(ipAddress: string): Promise<DesktopLocalRelayCertificate> {
		const ref = { namespace: CREDENTIAL_NAMESPACE, ownerId: CREDENTIAL_OWNER, name: LOCAL_RELAY_CERT_CREDENTIAL };
		const stored = this.vault.get(ref);
		if (stored) {
			let parsed: DesktopLocalRelayCertificate;
			try {
				parsed = JSON.parse(stored) as DesktopLocalRelayCertificate;
			} catch (error) {
				throw new Error("Saved local relay certificate is malformed; create a new pairing.", { cause: error });
			}
			if (!parsed.certificate || !parsed.privateKey || !parsed.fingerprint) {
				throw new Error("Saved local relay certificate is incomplete; create a new pairing.");
			}
			if (isDesktopLocalRelayCertificateAuthority(parsed.certificate)) return parsed;
			this.certificateChangedForUpgrade = true;
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
		const protocol = parsed.protocol === "wss:" ? "https:" : parsed.protocol;
		return `${protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
	} catch {
		return undefined;
	}
}

function toWebSocketBaseUrl(value: string): string {
	const parsed = new URL(value);
	if (parsed.protocol === "https:") parsed.protocol = "wss:";
	if (parsed.protocol !== "wss:") throw new Error("中继地址必须使用 HTTPS/WSS");
	return `${parsed.protocol}//${parsed.host}${parsed.pathname}`.replace(/\/$/, "");
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
