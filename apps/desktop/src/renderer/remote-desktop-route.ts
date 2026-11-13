import {
	REMOTE_DESKTOP_PROTOCOL_VERSION,
	RemoteDesktopHost,
	type RemoteDesktopLogger,
	type RemoteDesktopPeerOptions,
	type RemoteDesktopWebSocketFactory,
	type RemoteInputMessage,
	WebSocketRemoteDesktopSignaling,
} from "@567agent/remote-desktop";
import type { RemoteDesktopCapture } from "./remote-desktop-capture.js";
import { handleRemoteDesktopPeerReady } from "./remote-desktop-peer-ready.js";

interface RouteOptions {
	readonly target: string;
	readonly sessionId: string;
	readonly capture: RemoteDesktopCapture;
	readonly requestCapture: () => void;
	readonly onInput: (message: RemoteInputMessage) => void;
	readonly logger: RemoteDesktopLogger;
	readonly createSocket?: RemoteDesktopWebSocketFactory;
	readonly createPeerConnection?: RemoteDesktopPeerOptions["createPeerConnection"];
}

/** Owns one signaling route and retires its old peer before creating a replacement. */
export class RemoteDesktopRoute {
	private signaling?: WebSocketRemoteDesktopSignaling;
	private host?: RemoteDesktopHost;
	private stream?: MediaStream;
	private reconnectTimer?: ReturnType<typeof setTimeout>;
	private connecting = false;
	private capturing = false;
	private captureRequested = false;
	private hostGeneration = 0;
	private closed = false;
	private inputEnabled = false;
	private pointerMode: "absolute" | "relative" = "absolute";

	constructor(private readonly options: RouteOptions) {}

	setInputEnabled(enabled: boolean, mode: "absolute" | "relative"): void {
		this.inputEnabled = enabled;
		this.pointerMode = mode;
		this.host?.setInputEnabled(enabled, mode);
	}

	async connect(): Promise<void> {
		if (this.closed || this.connecting) return;
		this.connecting = true;
		const signaling = new WebSocketRemoteDesktopSignaling(this.options.target, this.options.createSocket);
		this.signaling = signaling;
		try {
			await signaling.connect({
				onSignal: (signal) => {
					if (this.closed || this.signaling !== signaling) return;
					if (signal.type !== "peer_ready" && signal.sessionId !== this.options.sessionId) return;
					if (signal.type === "end") {
						this.cleanupHost();
						return;
					}
					const host = this.host;
					const accepted =
						signal.type === "peer_ready"
							? handleRemoteDesktopPeerReady(host, () => this.requestCapture())
							: host?.acceptSignal(signal);
					void accepted?.catch((error: unknown) => {
						if (this.signaling !== signaling || this.host !== host) return;
						this.log("warn", "remote desktop signal handling failed", error);
						this.cleanupHost();
					});
				},
				onClose: (reason) => {
					if (this.closed || this.signaling !== signaling) return;
					this.log("warn", "remote desktop signaling closed", reason);
					if (this.host?.connectionState !== "connected") this.cleanupHost();
					this.scheduleReconnect();
				},
			});
			this.log("info", "remote desktop signaling connected");
		} catch (error) {
			if (this.closed || this.signaling !== signaling) return;
			this.log("warn", "remote desktop signaling connection failed", error);
			if (this.host?.connectionState !== "connected") this.cleanupHost();
			this.scheduleReconnect();
		} finally {
			this.connecting = false;
		}
	}

	async startHost(): Promise<void> {
		const signaling = this.signaling;
		if (this.host || this.capturing || this.closed || !signaling?.connected) return;
		this.capturing = true;
		this.captureRequested = false;
		const generation = this.hostGeneration;
		let host: RemoteDesktopHost | undefined;
		try {
			const stream = await this.options.capture.acquire();
			if (
				this.closed ||
				this.hostGeneration !== generation ||
				this.signaling !== signaling ||
				!signaling.connected
			) {
				this.options.capture.release(stream);
				return;
			}
			host = new RemoteDesktopHost(
				{
					sessionId: this.options.sessionId,
					pointerMode: this.pointerMode,
					inputEnabled: this.inputEnabled,
					logger: this.options.logger,
					createPeerConnection: this.options.createPeerConnection,
				},
				async (signal) => {
					// Old peers must not send an end/ICE packet into a newly connected viewer.
					if (this.closed || this.host !== host || !this.signaling?.connected) return;
					try {
						await this.signaling.send(signal);
					} catch (error) {
						this.log("warn", "remote desktop signal not sent", error);
					}
				},
				(message) => {
					if (this.host === host && !this.closed) this.options.onInput(message);
				},
			);
			this.stream = stream;
			this.host = host;
			const replace = () => {
				if (this.host !== host || this.closed) return;
				this.cleanupHost();
				this.requestCapture();
			};
			await host.start(stream, {
				onViewerReplaced: replace,
				onConnectionStateChange: (state) => {
					if (state === "failed" || state === "closed") replace();
				},
			});
			this.log("info", "remote desktop stream started");
		} catch (error) {
			if (
				this.closed ||
				this.hostGeneration !== generation ||
				this.signaling !== signaling ||
				(host && this.host !== host)
			)
				return;
			this.log("warn", "remote desktop capture or startup failed", error);
			try {
				await signaling.send({
					type: "end",
					protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
					sessionId: this.options.sessionId,
					reason:
						error instanceof DOMException && ["NotAllowedError", "AbortError"].includes(error.name)
							? "capture_denied"
							: "capture_unavailable",
				});
			} catch {
				this.log("warn", "remote desktop capture failure could not be reported");
			}
			this.cleanupHost();
		} finally {
			this.capturing = false;
			if (this.captureRequested) this.requestCapture();
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.cleanupHost();
		void this.signaling?.close();
	}

	private requestCapture(): void {
		if (this.closed || !this.signaling?.connected) return;
		this.captureRequested = true;
		if (!this.capturing) this.options.requestCapture();
	}

	private cleanupHost(): void {
		this.hostGeneration++;
		this.captureRequested = false;
		const host = this.host;
		this.host = undefined;
		// Detach first: close() can synchronously deliver a connectionstatechange.
		host?.close("failed", { notifyPeer: false });
		if (this.stream) this.options.capture.release(this.stream);
		this.stream = undefined;
	}

	private scheduleReconnect(): void {
		if (this.closed || this.reconnectTimer) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = undefined;
			void this.connect();
		}, 2_000);
	}

	private log(level: "info" | "warn", message: string, error?: unknown): void {
		const url = new URL(this.options.target.split("#", 1)[0]!);
		const detail = error instanceof Error ? error.message : error;
		this.options.logger[level](`${message} ${JSON.stringify({ target: `${url.origin}${url.pathname}`, detail })}`);
	}
}
