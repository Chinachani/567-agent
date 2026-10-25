import {
	REMOTE_DESKTOP_PROTOCOL_VERSION,
	RemoteDesktopHost,
	WebSocketRemoteDesktopSignaling,
} from "@567agent/remote-desktop";
import { RemoteDesktopCapture } from "./remote-desktop-capture.js";
import { handleRemoteDesktopPeerReady } from "./remote-desktop-peer-ready.js";

declare global {
	interface Window {
		vettaRemoteDesktop?: {
			requestCapture(routeIndex: number): void;
			onInput(message: unknown): void;
		};
		agent567RemoteDesktop?: Window["vettaRemoteDesktop"];
	}
}

interface RelayRoute {
	readonly index: number;
	readonly target: string;
	signaling?: WebSocketRemoteDesktopSignaling;
	host?: RemoteDesktopHost;
	stream?: MediaStream;
	reconnectTimer?: ReturnType<typeof setTimeout>;
	connecting: boolean;
	capturing: boolean;
	closed: boolean;
}

const params = new URLSearchParams(window.location.search);
const sessionId = params.get("sessionId");
const capture = new RemoteDesktopCapture(() => navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }));
capture.setRetained(params.get("retainCapture") === "true");
window.addEventListener("vetta:remote-desktop:retain-capture", (event) => {
	capture.setRetained((event as CustomEvent<unknown>).detail === true);
});
let targets: string[];
try {
	const parsed: unknown = JSON.parse(params.get("targets") ?? "[]");
	targets = Array.isArray(parsed) ? parsed.filter((target): target is string => typeof target === "string") : [];
} catch {
	targets = [];
}
if (!sessionId || targets.length === 0) throw new Error("remote desktop host targets are missing");

const routes: RelayRoute[] = targets.map((target, index) => ({
	index,
	target,
	connecting: false,
	capturing: false,
	closed: false,
}));

let inputEnabled = false;
window.addEventListener("vetta:remote-desktop:input-permission", (event) => {
	inputEnabled = (event as CustomEvent<unknown>).detail === true;
	for (const route of routes) route.host?.setInputEnabled(inputEnabled);
});

for (const route of routes) void connectRoute(route);

async function connectRoute(route: RelayRoute): Promise<void> {
	if (route.closed || route.connecting) return;
	route.connecting = true;
	const signaling = new WebSocketRemoteDesktopSignaling(route.target);
	route.signaling = signaling;
	try {
		await signaling.connect({
			async onSignal(signal) {
				if (signal.type === "peer_ready") {
					console.info(
						diagnostic("remote desktop peer is ready; requesting display capture", {
							target: safeTarget(route.target),
						}),
					);
					try {
						await handleRemoteDesktopPeerReady(route.host, () =>
							window.agent567RemoteDesktop?.requestCapture(route.index),
						);
					} catch (error) {
						console.warn(
							diagnostic("remote desktop signal handling failed", {
								error: error instanceof Error ? error.message : String(error),
								target: safeTarget(route.target),
							}),
						);
						cleanupRoute(route);
					}
					return;
				}
				if (route.host) {
					try {
						await route.host.acceptSignal(signal);
					} catch (error) {
						console.warn(
							diagnostic("remote desktop signal handling failed", {
								error: error instanceof Error ? error.message : String(error),
								target: safeTarget(route.target),
							}),
						);
						cleanupRoute(route);
					}
				}
			},
			onClose(reason) {
				console.warn(diagnostic("remote desktop signaling closed", { reason, target: safeTarget(route.target) }));
				const directPeerIsAlive = route.host?.connectionState === "connected";
				if (!directPeerIsAlive) cleanupRoute(route);
				scheduleReconnect(route);
			},
		});
		console.info(diagnostic("remote desktop signaling connected", { target: safeTarget(route.target) }));
	} catch (error) {
		console.warn(
			diagnostic("remote desktop signaling connection failed", {
				error: error instanceof Error ? error.message : String(error),
				target: safeTarget(route.target),
			}),
		);
		if (route.host?.connectionState !== "connected") cleanupRoute(route);
		scheduleReconnect(route);
	} finally {
		route.connecting = false;
	}
}

window.addEventListener("vetta:remote-desktop:capture-request", (event) => {
	const routeIndex = (event as CustomEvent<unknown>).detail;
	if (typeof routeIndex !== "number" || !Number.isSafeInteger(routeIndex)) return;
	const route = routes[routeIndex];
	const signaling = route?.signaling;
	if (!route || !signaling) return;
	void startHostForRoute(route, signaling);
});

async function startHostForRoute(route: RelayRoute, signaling: WebSocketRemoteDesktopSignaling): Promise<void> {
	if (route.host || route.capturing || route.closed) return;
	route.capturing = true;
	try {
		const stream = await capture.acquire();
		if (route.closed || route.signaling !== signaling) {
			capture.release(stream);
			return;
		}
		const host = new RemoteDesktopHost(
			{
				sessionId: sessionId!,
				pointerMode: params.get("pointerMode") === "relative" ? "relative" : "absolute",
				inputEnabled,
				logger: {
					debug: (message, fields) => console.debug(message, fields),
					info: (message, fields) => console.info(message, fields),
					warn: (message, fields) => console.warn(message, fields),
				},
			},
			async (signal) => {
				const activeSignaling = route.signaling;
				if (!activeSignaling?.connected) return;
				try {
					await activeSignaling.send(signal);
				} catch (signalError) {
					console.warn(
						diagnostic("remote desktop signal not sent", {
							type: signal.type,
							error: signalError instanceof Error ? signalError.message : String(signalError),
							target: safeTarget(route.target),
						}),
					);
				}
			},
			(message) => window.agent567RemoteDesktop?.onInput(message),
		);
		route.stream = stream;
		route.host = host;
		await host.start(stream, {
			waitForPeerReady: false,
			onViewerReplaced: () => {
				cleanupRoute(route);
				if (route.signaling?.connected) window.agent567RemoteDesktop?.requestCapture(route.index);
			},
			onConnectionStateChange: (state) => {
				if (state !== "failed" && state !== "closed") return;
				cleanupRoute(route);
				if (route.signaling?.connected) window.agent567RemoteDesktop?.requestCapture(route.index);
			},
		});
		console.info(diagnostic("remote desktop stream started", { target: safeTarget(route.target) }));
	} catch (error) {
		console.warn(
			diagnostic("remote desktop capture or startup failed", {
				error: error instanceof Error ? error.message : String(error),
				target: safeTarget(route.target),
			}),
		);
		try {
			await signaling.send({
				type: "end",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				sessionId: sessionId!,
				reason:
					error instanceof DOMException && ["NotAllowedError", "AbortError"].includes(error.name)
						? "capture_denied"
						: "capture_unavailable",
			});
		} catch (signalError) {
			console.warn(
				diagnostic("remote desktop capture failure could not be reported", {
					error: signalError instanceof Error ? signalError.message : String(signalError),
					target: safeTarget(route.target),
				}),
			);
		}
		cleanupRoute(route);
	} finally {
		route.capturing = false;
	}
}

function cleanupRoute(route: RelayRoute): void {
	route.host?.close("failed");
	route.host = undefined;
	if (route.stream) capture.release(route.stream);
	route.stream = undefined;
}

function scheduleReconnect(route: RelayRoute): void {
	if (route.closed || route.reconnectTimer) return;
	route.reconnectTimer = setTimeout(() => {
		route.reconnectTimer = undefined;
		void connectRoute(route);
	}, 2_000);
}

function safeTarget(target: string): string {
	try {
		const url = new URL(target.split("#", 1)[0]!);
		return `${url.origin}${url.pathname}`;
	} catch {
		return "invalid target";
	}
}

function diagnostic(message: string, fields: Record<string, unknown>): string {
	return `${message} ${JSON.stringify(fields)}`;
}

window.addEventListener("pagehide", () => {
	capture.close();
	for (const route of routes) {
		route.closed = true;
		if (route.reconnectTimer) clearTimeout(route.reconnectTimer);
		cleanupRoute(route);
		void route.signaling?.close();
	}
});
