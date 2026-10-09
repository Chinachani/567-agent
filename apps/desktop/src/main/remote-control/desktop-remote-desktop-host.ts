import { randomUUID, X509Certificate } from "node:crypto";
import { decodeRemoteInputMessage } from "@567agent/remote-desktop";
import { BrowserWindow, desktopCapturer, dialog, ipcMain, screen, session, webContents } from "electron";
import type { RemotePairingState } from "../../preload/api-types/remote-pairing.js";
import { mainT } from "../i18n/index.js";
import { getAppLogger } from "../logger.js";
import {
	configureRemoteDesktopHostMediaPermissions,
	registerRemoteDesktopVideoPermission,
} from "../speech-input/media-permissions.js";
import { getMainWindow } from "../window-manager.js";
import { resolveDesktopRemoteDesktopHostPaths } from "./desktop-remote-desktop-host-paths.js";
import { createSystemInputAdapter } from "./system-input.js";

export interface DesktopRemoteDesktopHostOptions {
	readonly signalingUrl?: string;
	readonly pairingToken?: string;
	readonly signalingTarget?: string;
	readonly signalingTargets?: readonly string[];
	readonly inputEnabled: boolean;
	readonly autoShareScreen?: boolean;
	readonly onAutoShareScreenChange?: (enabled: boolean) => Promise<void>;
	readonly appRoot: string;
	readonly isPackaged: boolean;
	readonly devServerUrl?: string;
}

export interface DesktopRemoteDesktopHostHandle {
	readonly sessionId: string;
	readonly inputSupported: boolean;
	readonly inputSupportReason?: RemotePairingState["inputSupportReason"];
	revokeInput(): void;
	grantInput(): void;
	setAutoShareScreen(enabled: boolean): void;
	stop(): Promise<void>;
}

const log = getAppLogger("remote-desktop-host");
let activeHost: DesktopRemoteDesktopHostHandle | undefined;

/** Starts the hidden renderer only when an explicit relay target is configured. */
export async function startDesktopRemoteDesktopHost(
	options: DesktopRemoteDesktopHostOptions,
): Promise<DesktopRemoteDesktopHostHandle> {
	if (activeHost) return activeHost;
	const signalingTargets = options.signalingTargets ?? [
		options.signalingTarget ?? `${options.signalingUrl}#${options.pairingToken}`,
	];
	const sessionId = remoteDesktopSessionId(signalingTargets[0] ?? "") ?? `desktop-${randomUUID()}`;
	const input = createSystemInputAdapter({ enabled: options.inputEnabled });
	input.setEnabled(options.inputEnabled);
	const paths = resolveDesktopRemoteDesktopHostPaths(options);
	const hostSession = session.fromPartition(`vetta-remote-desktop-${sessionId}`);
	const pinnedOrigins = new Map(
		signalingTargets.flatMap((target) => {
			const fingerprint = readTargetFingerprint(target);
			const origin = readTargetOrigin(target);
			return fingerprint && origin ? [[origin, fingerprint] as const] : [];
		}),
	);
	const window = new BrowserWindow({
		show: false,
		width: 1280,
		height: 720,
		webPreferences: {
			session: hostSession,
			backgroundThrottling: false,
			contextIsolation: true,
			nodeIntegration: false,
			preload: paths.preloadPath,
		},
	});
	let autoShareScreen = options.autoShareScreen === true;
	const unregisterHostMediaPermissions = configureRemoteDesktopHostMediaPermissions(hostSession);
	const onCertificateError = (
		event: Electron.Event,
		url: string,
		_error: string,
		certificate: Electron.Certificate,
		callback: (isTrusted: boolean) => void,
	): void => {
		let origin: string | undefined;
		try {
			origin = new URL(url).origin;
		} catch {
			log.warn("remote desktop signaling certificate rejected", { sessionId, reason: "invalid_origin" });
			callback(false);
			return;
		}
		const expectedFingerprint = pinnedOrigins.get(origin);
		let actualFingerprint: string | undefined;
		try {
			actualFingerprint = new X509Certificate(certificate.data).fingerprint256.replaceAll(":", "").toLowerCase();
		} catch {
			actualFingerprint = undefined;
		}
		const matches = expectedFingerprint !== undefined && actualFingerprint === expectedFingerprint;
		if (!matches) {
			log.warn("remote desktop signaling certificate rejected", {
				sessionId,
				origin,
				error: _error,
				pinnedOriginConfigured: expectedFingerprint !== undefined,
				fingerprintMatches: false,
			});
			callback(false);
			return;
		}
		event.preventDefault();
		callback(true);
	};
	window.webContents.on("certificate-error", onCertificateError);
	const unregisterVideoPermission = registerRemoteDesktopVideoPermission(window.webContents.id);
	window.webContents.on("console-message", (_event, levelOrDetails, legacyMessage) => {
		// Electron versions have emitted both the legacy (level, message) pair and
		// a details object. Normalize both so signaling errors keep their cause.
		const details =
			typeof levelOrDetails === "number" ? { level: levelOrDetails, message: legacyMessage ?? "" } : levelOrDetails;
		const fields = { sessionId, level: details.level };
		if (details.level >= 2) log.warn(`renderer: ${details.message}`, fields);
		else log.info(`renderer: ${details.message}`, fields);
	});
	let captureSourceSupportsRemoteInput = false;
	const onInput = (_event: Electron.IpcMainEvent, message: unknown): void => {
		if (_event.sender.id !== window.webContents.id) return;
		if (!captureSourceSupportsRemoteInput) {
			log.warn("remote desktop input rejected for unsupported capture source", { sessionId });
			return;
		}
		try {
			input.apply(decodeRemoteInputMessage(message));
		} catch {
			log.warn("invalid remote desktop IPC input rejected", { sessionId });
		}
	};
	const onRequestCapture = (_event: Electron.IpcMainEvent, routeIndex: unknown): void => {
		if (_event.sender.id !== window.webContents.id) return;
		if (
			typeof routeIndex !== "number" ||
			!Number.isSafeInteger(routeIndex) ||
			routeIndex < 0 ||
			routeIndex >= signalingTargets.length
		) {
			log.warn("invalid remote desktop capture route rejected", { sessionId });
			return;
		}
		log.info("remote desktop peer is ready; requesting display capture", { sessionId, routeIndex });
		void window.webContents
			.executeJavaScript(
				`window.dispatchEvent(new CustomEvent("vetta:remote-desktop:capture-request", { detail: ${routeIndex} }))`,
				true,
			)
			.catch((error: unknown) => log.warn("remote desktop capture activation failed", { sessionId, error }));
	};
	ipcMain.on("vetta:remote-desktop:input", onInput);
	ipcMain.on("vetta:remote-desktop:request-capture", onRequestCapture);
	let displayMediaHandlerInstalled = false;
	try {
		// The hidden renderer must never silently capture the first screen. Ask for
		// explicit, per-session consent and let the user choose the source first.
		hostSession.setDisplayMediaRequestHandler((request, callback) => {
			const requestingWebContents = request.frame ? webContents.fromFrame(request.frame) : undefined;
			log.info("remote desktop display capture requested", {
				sessionId,
				webContentsMatches: requestingWebContents?.id === window.webContents.id,
				videoRequested: request.videoRequested,
				audioRequested: request.audioRequested,
			});
			if (requestingWebContents?.id !== window.webContents.id || !request.videoRequested || request.audioRequested) {
				log.warn("remote desktop display media request rejected", {
					sessionId,
					hasFrame: request.frame !== null,
					videoRequested: request.videoRequested,
					audioRequested: request.audioRequested,
				});
				callback({ video: undefined });
				return;
			}
			void (async () => {
				if (!autoShareScreen) {
					const consent = await showRemoteDesktopDialog({
						type: "question",
						title: mainT("remoteDesktopCapture.title"),
						message: mainT("remoteDesktopCapture.message"),
						detail: mainT("remoteDesktopCapture.detail"),
						checkboxLabel: mainT("remoteDesktopCapture.rememberDevice"),
						checkboxChecked: false,
						buttons: [mainT("remoteDesktopCapture.allowOnce"), mainT("remoteDesktopCapture.cancel")],
						defaultId: 0,
						cancelId: 1,
					});
					if (consent.response !== 0 || window.isDestroyed()) {
						callback({ video: undefined });
						return;
					}
					if (consent.checkboxChecked) {
						autoShareScreen = true;
						await options.onAutoShareScreenChange?.(true);
					}
				}
				const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
				if (sources.length === 0) {
					log.warn("remote desktop screen capture source unavailable", { sessionId });
					await showRemoteDesktopDialog({
						type: "warning",
						title: mainT("remoteDesktopCapture.title"),
						message: mainT("remoteDesktopCapture.noSources"),
						buttons: [mainT("remoteDesktopCapture.cancel")],
					});
					callback({ video: undefined });
					return;
				}
				const primaryDisplayId = String(screen.getPrimaryDisplay().id);
				const primaryScreen = sources.find(
					(source) => source.id.startsWith("screen:") && source.display_id === primaryDisplayId,
				);
				let source = autoShareScreen ? primaryScreen : undefined;
				if (!source) {
					const sourceChoice = await showRemoteDesktopDialog({
						type: "question",
						title: mainT("remoteDesktopCapture.chooseTitle"),
						message: mainT("remoteDesktopCapture.chooseMessage"),
						buttons: [
							mainT("remoteDesktopCapture.cancel"),
							...sources.map(
								(candidate, index) =>
									candidate.name.trim() || mainT("remoteDesktopCapture.sourceFallback", { index: index + 1 }),
							),
						],
						defaultId: 1,
						cancelId: 0,
					});
					source = sources[sourceChoice.response - 1];
				}
				if (!source || window.isDestroyed()) {
					callback({ video: undefined });
					return;
				}
				captureSourceSupportsRemoteInput =
					source.id.startsWith("screen:") && source.display_id === primaryDisplayId;
				log.info("remote desktop screen capture granted", { sessionId, sourceCount: sources.length });
				callback({ video: source });
			})().catch((error: unknown) => {
				log.warn("remote desktop screen capture request failed", { sessionId, error });
				callback({ video: undefined });
			});
		});
		displayMediaHandlerInstalled = true;

		if (options.isPackaged) {
			await window.loadFile(paths.pagePath, {
				query: { targets: JSON.stringify(signalingTargets), sessionId },
			});
		} else {
			const page = `${options.devServerUrl ?? "http://127.0.0.1:3020"}/remote-desktop-host.html`;
			await window.loadURL(
				`${page}?targets=${encodeURIComponent(JSON.stringify(signalingTargets))}&sessionId=${encodeURIComponent(sessionId)}`,
			);
		}
	} catch (error) {
		input.setEnabled(false);
		unregisterVideoPermission();
		unregisterHostMediaPermissions();
		window.webContents.removeListener("certificate-error", onCertificateError);
		ipcMain.removeListener("vetta:remote-desktop:input", onInput);
		ipcMain.removeListener("vetta:remote-desktop:request-capture", onRequestCapture);
		if (displayMediaHandlerInstalled) hostSession.setDisplayMediaRequestHandler(null);
		if (!window.isDestroyed()) window.destroy();
		throw error;
	}
	log.info("remote desktop host started", { sessionId, inputEnabled: input.supported });

	const handle: DesktopRemoteDesktopHostHandle = {
		sessionId,
		inputSupported: input.supported,
		inputSupportReason: input.unsupportedReason,
		revokeInput() {
			input.setEnabled(false);
		},
		grantInput() {
			input.setEnabled(true);
		},
		setAutoShareScreen(enabled) {
			autoShareScreen = enabled;
		},
		async stop() {
			input.setEnabled(false);
			unregisterVideoPermission();
			unregisterHostMediaPermissions();
			window.webContents.removeListener("certificate-error", onCertificateError);
			hostSession.setDisplayMediaRequestHandler(null);
			ipcMain.removeListener("vetta:remote-desktop:input", onInput);
			ipcMain.removeListener("vetta:remote-desktop:request-capture", onRequestCapture);
			if (!window.isDestroyed()) window.destroy();
			activeHost = undefined;
			log.info("remote desktop host stopped", { sessionId });
		},
	};
	activeHost = handle;
	return handle;
}

function readTargetFingerprint(target: string): string | undefined {
	const fragment = target.split("#")[1];
	if (!fragment) return undefined;
	const value = new URLSearchParams(fragment).get("fingerprint")?.toLowerCase();
	return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function showRemoteDesktopDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
	const parent = getMainWindow();
	return parent && !parent.isDestroyed() ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function readTargetOrigin(target: string): string | undefined {
	try {
		return new URL(target.split("#")[0]!).origin;
	} catch {
		return undefined;
	}
}

export async function stopDesktopRemoteDesktopHost(): Promise<void> {
	await activeHost?.stop();
}

function remoteDesktopSessionId(target: string): string | undefined {
	return /\/v1\/desktop\/([A-Za-z0-9_-]{24,128})\/host(?:#|$)/.exec(target)?.[1];
}
