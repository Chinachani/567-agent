import type { RemoteDesktopPeerOptions } from "./peer-types.js";
import { NOOP_REMOTE_DESKTOP_LOGGER, REMOTE_DESKTOP_ICE_SERVERS } from "./peer-types.js";
import {
	decodeRemoteDesktopSignal,
	encodeRemoteInputMessage,
	parseRemoteInputMessage,
	parseRemoteViewportMessage,
} from "./protocol.js";
import { answerWithStartBitrate, preferHardwareCodec } from "./screen-encoding.js";
import { ScreenSender } from "./screen-sender.js";
import type { RemoteDesktopSignal, RemoteInputCommand, RemoteInputMessage } from "./types.js";
import { REMOTE_DESKTOP_PROTOCOL_VERSION } from "./types.js";

export type RemoteDesktopSignalSender = (signal: RemoteDesktopSignal) => void | Promise<void>;

export interface RemoteDesktopHostStartOptions {
	/** Wait for the relay to confirm that a viewer is online before creating an offer. */
	readonly waitForPeerReady?: boolean;
	/** Recreate the host when the viewer rejoins signaling but its existing direct peer has dropped. */
	readonly onViewerReplaced?: () => void;
	/** Observe peer state so a host can distinguish relay loss from a dead direct connection. */
	readonly onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
}

export class RemoteDesktopHost {
	private readonly peer: RTCPeerConnection;
	private readonly logger;
	private readonly pendingIce: RTCIceCandidateInit[] = [];
	private inputChannel: RTCDataChannel | undefined;
	private inputEnabled: boolean;
	private lastInputSequence = 0;
	private lastViewportSequence = 0;
	private closed = false;
	private started = false;
	private peerReady = false;
	private hasNegotiated = false;
	private negotiation: Promise<void> | undefined;
	private onViewerReplaced: (() => void) | undefined;
	private onConnectionStateChange: ((state: RTCPeerConnectionState) => void) | undefined;
	private viewerRejoined = false;
	private screen: ScreenSender | undefined;
	private statsTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly options: RemoteDesktopPeerOptions,
		private readonly sendSignal: RemoteDesktopSignalSender,
		private readonly onInput: (message: RemoteInputMessage) => void | Promise<void>,
	) {
		this.inputEnabled = options.inputEnabled ?? true;
		this.logger = options.logger ?? NOOP_REMOTE_DESKTOP_LOGGER;
		this.peer = createPeer(options);
		this.peer.onicecandidate = (event) => {
			if (!event.candidate) return;
			void this.sendSignal({
				type: "ice",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				sessionId: options.sessionId,
				candidate: event.candidate.candidate,
				sdpMid: event.candidate.sdpMid,
				sdpMLineIndex: event.candidate.sdpMLineIndex,
			});
		};
		this.peer.onconnectionstatechange = () => {
			const state = this.peer.connectionState;
			this.logger.info("remote desktop host peer state", {
				sessionId: options.sessionId,
				state,
			});
			this.onConnectionStateChange?.(state);
			if (this.viewerRejoined && state !== "connected" && this.onViewerReplaced && !this.closed) {
				this.viewerRejoined = false;
				this.logger.info("remote desktop viewer replaced", { sessionId: options.sessionId, state });
				this.onViewerReplaced();
			}
		};
	}

	async start(stream: MediaStream, startOptions: RemoteDesktopHostStartOptions = {}): Promise<void> {
		if (this.closed) throw new Error("remote desktop host is closed");
		if (this.started) throw new Error("remote desktop host is already started");
		this.onViewerReplaced = startOptions.onViewerReplaced;
		this.onConnectionStateChange = startOptions.onConnectionStateChange;
		if (stream.getVideoTracks().length === 0) throw new Error("screen stream must contain a video track");
		for (const track of stream.getTracks()) {
			const sender = this.peer.addTrack(track, stream);
			if (track.kind === "video") this.screen = new ScreenSender(sender, this.logger);
		}
		for (const transceiver of this.peer.getTransceivers?.() ?? []) {
			if (transceiver.sender.track?.kind === "video") preferHardwareCodec(transceiver);
		}
		this.inputChannel = this.peer.createDataChannel("vetta-input-v1", { ordered: true });
		this.configureInputChannel(this.inputChannel);
		this.started = true;
		if (startOptions.waitForPeerReady !== true || this.peerReady) await this.negotiate();
	}

	async acceptSignal(signal: RemoteDesktopSignal): Promise<void> {
		const frame = decodeRemoteDesktopSignal(signal);
		if (frame.type === "peer_ready") {
			this.peerReady = true;
			if (this.hasNegotiated && this.peer.connectionState === "connected") {
				this.viewerRejoined = true;
				this.logger.info("remote desktop viewer rejoined signaling", { sessionId: this.options.sessionId });
				return;
			}
			if (this.hasNegotiated && this.onViewerReplaced) {
				this.onViewerReplaced();
				return;
			}
			if (this.started) await this.negotiate();
			return;
		}
		if (frame.sessionId !== this.options.sessionId) throw new Error("remote desktop signal session mismatch");
		if (frame.type === "answer") {
			await this.peer.setRemoteDescription({ type: "answer", sdp: answerWithStartBitrate(frame.sdp) });
			await this.screen?.update();
			this.scheduleStats();
			await this.flushPendingIce();
			return;
		}
		if (frame.type === "ice") {
			await this.addIce({ candidate: frame.candidate, sdpMid: frame.sdpMid, sdpMLineIndex: frame.sdpMLineIndex });
			return;
		}
		if (frame.type === "end") this.close(frame.reason);
	}

	close(reason: Extract<RemoteDesktopSignal, { type: "end" }>["reason"] = "completed"): void {
		if (this.closed) return;
		this.closed = true;
		if (this.statsTimer !== undefined) clearTimeout(this.statsTimer);
		this.screen?.close();
		this.inputChannel?.close();
		for (const sender of this.peer.getSenders()) sender.track?.stop();
		this.peer.close();
		try {
			void Promise.resolve(
				this.sendSignal({
					type: "end",
					protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
					sessionId: this.options.sessionId,
					reason,
				}),
			).catch(() => undefined);
		} catch {
			// Closing locally remains successful when the signaling transport is already gone.
		}
	}

	get connectionState(): RTCPeerConnectionState {
		return this.peer.connectionState;
	}

	setInputEnabled(enabled: boolean): void {
		this.inputEnabled = enabled;
		this.sendCapabilities();
	}

	private sendCapabilities(): void {
		if (this.inputChannel?.readyState !== "open") return;
		this.inputChannel.send(
			JSON.stringify({
				type: "capabilities",
				textInput: true,
				viewport: true,
				pointerMode: this.options.pointerMode ?? "absolute",
				inputEnabled: this.inputEnabled,
			}),
		);
	}

	private configureInputChannel(channel: RTCDataChannel): void {
		channel.onopen = () => this.sendCapabilities();
		channel.onmessage = (event) => {
			if (this.closed) return;
			if (typeof event.data !== "string" || event.data.length > 8192) {
				this.logger.warn("remote desktop binary input rejected", { sessionId: this.options.sessionId });
				channel.close();
				return;
			}
			try {
				const value: unknown = JSON.parse(event.data);
				const isView = value !== null && typeof value === "object" && "type" in value && value.type === "viewport";
				const message = isView ? parseRemoteViewportMessage(value) : parseRemoteInputMessage(event.data);
				if (message.type === "viewport") {
					if (message.sequence <= this.lastViewportSequence) return;
					this.lastViewportSequence = message.sequence;
					void this.screen?.view(message).catch(() => this.logger.warn("remote desktop viewport update failed"));
					return;
				}
				if (message.sequence <= this.lastInputSequence) {
					this.logger.warn("remote desktop replayed input ignored", {
						sessionId: this.options.sessionId,
						sequence: message.sequence,
					});
					return;
				}
				this.lastInputSequence = message.sequence;
				if (this.inputEnabled || message.type === "heartbeat") void this.onInput(message);
			} catch {
				this.logger.warn("remote desktop invalid input rejected", { sessionId: this.options.sessionId });
				channel.close();
			}
		};
	}

	private scheduleStats(): void {
		if (this.statsTimer !== undefined || this.closed || !this.screen) return;
		this.statsTimer = setTimeout(() => {
			this.statsTimer = undefined;
			if (this.closed) return;
			void this.screen
				?.sample(() => this.peer.getStats())
				.catch(() => undefined)
				.finally(() => this.scheduleStats());
		}, 1000);
	}

	private async addIce(candidate: RTCIceCandidateInit): Promise<void> {
		if (!this.peer.remoteDescription) {
			this.pendingIce.push(candidate);
			return;
		}
		await this.peer.addIceCandidate(candidate);
	}

	private async flushPendingIce(): Promise<void> {
		for (const candidate of this.pendingIce.splice(0)) await this.peer.addIceCandidate(candidate);
	}

	private async negotiate(): Promise<void> {
		if (this.negotiation) return this.negotiation;
		if (this.peer.signalingState !== "stable") {
			this.logger.debug("remote desktop host negotiation already pending", {
				sessionId: this.options.sessionId,
				state: this.peer.signalingState,
			});
			return;
		}
		const negotiation = (async () => {
			const offer = await this.peer.createOffer(this.hasNegotiated ? { iceRestart: true } : undefined);
			await this.peer.setLocalDescription(offer);
			if (!offer.sdp) throw new Error("WebRTC offer did not include SDP");
			await this.sendSignal({
				type: "offer",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				sessionId: this.options.sessionId,
				sdp: offer.sdp,
			});
			this.hasNegotiated = true;
		})();
		this.negotiation = negotiation;
		try {
			await negotiation;
		} finally {
			if (this.negotiation === negotiation) this.negotiation = undefined;
		}
	}
}

export class RemoteDesktopViewer {
	private readonly peer: RTCPeerConnection;
	private readonly logger;
	private readonly pendingIce: RTCIceCandidateInit[] = [];
	private inputChannel: RTCDataChannel | undefined;
	private closed = false;
	private nextSequence = 1;
	private viewportSupported = false;
	private inputReadyResolve: (() => void) | undefined;
	private inputFailure: Error | undefined;
	private readonly inputReady = new Promise<void>((resolve) => {
		this.inputReadyResolve = resolve;
	});

	constructor(
		private readonly options: RemoteDesktopPeerOptions,
		private readonly sendSignal: RemoteDesktopSignalSender,
		private readonly onStream: (stream: MediaStream) => void,
	) {
		this.logger = options.logger ?? NOOP_REMOTE_DESKTOP_LOGGER;
		this.peer = createPeer(options);
		this.peer.onicecandidate = (event) => {
			if (!event.candidate) return;
			void this.sendSignal({
				type: "ice",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				sessionId: options.sessionId,
				candidate: event.candidate.candidate,
				sdpMid: event.candidate.sdpMid,
				sdpMLineIndex: event.candidate.sdpMLineIndex,
			});
		};
		this.peer.ontrack = (event) => {
			const stream = event.streams[0] ?? new MediaStream([event.track]);
			this.onStream(stream);
		};
		this.peer.ondatachannel = (event) => {
			if (event.channel.label !== "vetta-input-v1" || this.inputChannel) {
				event.channel.close();
				return;
			}
			this.inputChannel = event.channel;
			event.channel.onopen = () => this.inputReadyResolve?.();
			event.channel.onmessage = (event) => {
				if (typeof event.data !== "string" || event.data.length > 4096) return;
				try {
					const value = JSON.parse(event.data);
					if (value.type === "capabilities") this.viewportSupported = value.viewport === true;
				} catch {
					/* Ignore unknown capabilities from legacy hosts. */
				}
			};
			event.channel.onclose = () => this.inputReadyResolve?.();
		};
		this.peer.onconnectionstatechange = () => {
			if (this.peer.connectionState === "failed") {
				this.inputFailure = new Error("remote desktop connection failed before input became ready");
				this.inputReadyResolve?.();
			}
			this.logger.info("remote desktop viewer peer state", {
				sessionId: options.sessionId,
				state: this.peer.connectionState,
			});
		};
	}

	async acceptSignal(signal: RemoteDesktopSignal): Promise<void> {
		const frame = decodeRemoteDesktopSignal(signal);
		if (frame.type === "peer_ready") return;
		if (frame.sessionId !== this.options.sessionId) throw new Error("remote desktop signal session mismatch");
		if (frame.type === "offer") {
			await this.peer.setRemoteDescription({ type: "offer", sdp: frame.sdp });
			await this.flushPendingIce();
			const answer = await this.peer.createAnswer();
			await this.peer.setLocalDescription(answer);
			if (!answer.sdp) throw new Error("WebRTC answer did not include SDP");
			await this.sendSignal({
				type: "answer",
				protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
				sessionId: this.options.sessionId,
				sdp: answer.sdp,
			});
			return;
		}
		if (frame.type === "ice") {
			await this.addIce({ candidate: frame.candidate, sdpMid: frame.sdpMid, sdpMLineIndex: frame.sdpMLineIndex });
			return;
		}
		if (frame.type === "end") this.close(frame.reason);
	}

	get supportsViewport(): boolean {
		return this.viewportSupported;
	}

	async sendViewport(width: number, height: number): Promise<boolean> {
		await this.inputReady;
		if (!this.viewportSupported || this.inputChannel?.readyState !== "open" || this.closed) return false;
		const message = parseRemoteViewportMessage({ type: "viewport", sequence: this.nextSequence++, width, height });
		this.inputChannel.send(JSON.stringify(message));
		return true;
	}

	async sendInput(message: RemoteInputCommand): Promise<void> {
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				this.inputReady,
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => reject(new Error("timed out waiting for remote input channel")), 30_000);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
		}
		if (this.inputFailure) throw this.inputFailure;
		if (this.closed) throw new Error("remote desktop viewer is closed");
		if (!this.inputChannel || this.inputChannel.readyState !== "open") {
			throw new Error("remote input channel is not open");
		}
		this.inputChannel.send(
			encodeRemoteInputMessage({ ...message, sequence: this.nextSequence++ } as RemoteInputMessage),
		);
	}

	close(reason: Extract<RemoteDesktopSignal, { type: "end" }>["reason"] = "completed"): void {
		if (this.closed) return;
		this.closed = true;
		this.inputReadyResolve?.();
		this.inputChannel?.close();
		this.peer.close();
		try {
			void Promise.resolve(
				this.sendSignal({
					type: "end",
					protocolVersion: REMOTE_DESKTOP_PROTOCOL_VERSION,
					sessionId: this.options.sessionId,
					reason,
				}),
			).catch(() => undefined);
		} catch {
			// Closing locally remains successful when the signaling transport is already gone.
		}
	}

	get connectionState(): RTCPeerConnectionState {
		return this.peer.connectionState;
	}

	private async addIce(candidate: RTCIceCandidateInit): Promise<void> {
		if (!this.peer.remoteDescription) {
			this.pendingIce.push(candidate);
			return;
		}
		await this.peer.addIceCandidate(candidate);
	}

	private async flushPendingIce(): Promise<void> {
		for (const candidate of this.pendingIce.splice(0)) await this.peer.addIceCandidate(candidate);
	}
}

function createPeer(options: RemoteDesktopPeerOptions): RTCPeerConnection {
	const configuration = options.rtcConfiguration ?? { iceServers: REMOTE_DESKTOP_ICE_SERVERS };
	return options.createPeerConnection?.(configuration) ?? new RTCPeerConnection(configuration);
}
