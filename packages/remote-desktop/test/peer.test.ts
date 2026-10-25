import { describe, expect, it, vi } from "vitest";
import { RemoteDesktopHost } from "../src/index.js";

describe("remote desktop host negotiation", () => {
	it("advertises relative input and validates a touchpad packet through the real channel handler", async () => {
		const peer = fakePeerConnection();
		const inputs: unknown[] = [];
		const host = new RemoteDesktopHost(
			{
				sessionId: "pairing_0123456789abcdefghijklmnop",
				pointerMode: "relative",
				createPeerConnection: () => peer.connection,
			},
			() => {},
			(message) => {
				inputs.push(message);
			},
		);
		await host.start(fakeStream());
		peer.channel.onopen?.(new Event("open"));
		expect(peer.channel.send).toHaveBeenCalledWith(
			JSON.stringify({
				type: "capabilities",
				textInput: true,
				viewport: true,
				pointerMode: "relative",
				inputEnabled: true,
			}),
		);
		const packet = { type: "pointer.relative", sequence: 1, deltaX: 25, deltaY: -10 };
		peer.channel.onmessage?.(new MessageEvent("message", { data: JSON.stringify(packet) }));
		peer.channel.onmessage?.(new MessageEvent("message", { data: JSON.stringify(packet) }));
		expect(inputs).toEqual([packet]);
		host.close();
	});
	it("announces permission changes and blocks clicks as soon as input is revoked", async () => {
		const peer = fakePeerConnection();
		const inputs: unknown[] = [];
		const host = new RemoteDesktopHost(
			{
				sessionId: "pairing_0123456789abcdefghijklmnop",
				inputEnabled: false,
				createPeerConnection: () => peer.connection,
			},
			() => {},
			(message) => {
				inputs.push(message);
			},
		);
		await host.start(fakeStream());
		peer.channel.onopen?.(new Event("open"));
		const click = (sequence: number) =>
			peer.channel.onmessage?.(
				new MessageEvent("message", {
					data: JSON.stringify({
						type: "pointer.button",
						sequence,
						x: 0.5,
						y: 0.5,
						button: "left",
						action: "down",
					}),
				}),
			);
		click(1);
		expect(inputs).toEqual([]);
		host.setInputEnabled(true);
		click(2);
		expect(inputs).toHaveLength(1);
		host.setInputEnabled(false);
		click(3);
		expect(inputs).toHaveLength(1);
		expect(JSON.parse(String(vi.mocked(peer.channel.send).mock.lastCall?.[0]))).toMatchObject({
			type: "capabilities",
			inputEnabled: false,
		});
		host.close();
	});

	it("tunes the negotiated sender from viewport feedback without enabling remote input", async () => {
		const peer = fakePeerConnection();
		const params: RTCRtpSendParameters = {
			encodings: [{}],
			codecs: [],
			headerExtensions: [],
			rtcp: {},
			transactionId: "t",
		};
		const track = {
			kind: "video",
			stop: vi.fn(),
			getSettings: () => ({ width: 2560, height: 1600 }),
		} as unknown as MediaStreamTrack;
		const sender = {
			track,
			getParameters: () => structuredClone(params),
			setParameters: vi.fn(async () => undefined),
		} as unknown as RTCRtpSender;
		vi.mocked(peer.connection.addTrack).mockReturnValue(sender);
		Object.assign(peer.connection, {
			setRemoteDescription: vi.fn(async () => undefined),
			getStats: vi.fn(async () => new Map()),
		});
		const input = vi.fn();
		const host = new RemoteDesktopHost(
			{ sessionId: "session", inputEnabled: false, createPeerConnection: () => peer.connection },
			() => {},
			input,
		);
		await host.start({ getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream);
		await host.acceptSignal({
			type: "answer",
			protocolVersion: 1,
			sessionId: "session",
			sdp: "v=0\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 profile-level-id=42e01f\r\n",
		});
		expect(peer.connection.setRemoteDescription).toHaveBeenCalledWith(
			expect.objectContaining({ sdp: expect.stringContaining("x-google-start-bitrate=4000") }),
		);
		peer.channel.onmessage?.(
			new MessageEvent("message", {
				data: JSON.stringify({ type: "viewport", sequence: 1, width: 1280, height: 800 }),
			}),
		);
		await vi.waitFor(() =>
			expect(sender.setParameters).toHaveBeenLastCalledWith(
				expect.objectContaining({
					encodings: [
						expect.objectContaining({ maxBitrate: 12000000, maxFramerate: 30, scaleResolutionDownBy: 2 }),
					],
				}),
			),
		);
		expect(input).not.toHaveBeenCalled();
		expect(peer.channel.close).not.toHaveBeenCalled();
		host.close();
	});

	it("waits for a relay peer-ready event before sending the offer", async () => {
		const peer = fakePeerConnection();
		const sent: unknown[] = [];
		const host = new RemoteDesktopHost(
			{
				sessionId: "pairing_0123456789abcdefghijklmnop",
				createPeerConnection: () => peer.connection,
			},
			(signal) => {
				sent.push(signal);
			},
			() => undefined,
		);

		await host.start(fakeStream(), { waitForPeerReady: true });
		expect(peer.createOffer).not.toHaveBeenCalled();
		expect(sent).toEqual([]);

		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });

		expect(peer.createOffer).toHaveBeenCalledOnce();
		expect(sent).toEqual([
			{
				type: "offer",
				protocolVersion: 1,
				sessionId: "pairing_0123456789abcdefghijklmnop",
				sdp: "v=0\r\n",
			},
		]);

		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		expect(peer.createOffer).toHaveBeenLastCalledWith({ iceRestart: true });
	});

	it("keeps an established direct peer when the viewer rejoins signaling", async () => {
		const peer = fakePeerConnection();
		const mutableConnection = peer.connection as unknown as { connectionState: RTCPeerConnectionState };
		const sendSignal = vi.fn();
		const onViewerReplaced = vi.fn();
		const host = new RemoteDesktopHost(
			{
				sessionId: "pairing_0123456789abcdefghijklmnop",
				createPeerConnection: () => peer.connection,
			},
			sendSignal,
			() => undefined,
		);

		await host.start(fakeStream(), { waitForPeerReady: true, onViewerReplaced });
		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });
		mutableConnection.connectionState = "connected";
		peer.connection.onconnectionstatechange?.(new Event("connectionstatechange"));
		await host.acceptSignal({ type: "peer_ready", protocolVersion: 1 });

		expect(peer.createOffer).toHaveBeenCalledTimes(1);
		expect(onViewerReplaced).not.toHaveBeenCalled();

		mutableConnection.connectionState = "failed";
		peer.connection.onconnectionstatechange?.(new Event("connectionstatechange"));
		expect(onViewerReplaced).toHaveBeenCalledOnce();
	});
});

function fakePeerConnection(): {
	readonly connection: RTCPeerConnection;
	readonly createOffer: ReturnType<typeof vi.fn>;
	readonly channel: RTCDataChannel;
} {
	const createOffer = vi.fn(async () => ({ type: "offer" as const, sdp: "v=0\r\n" }));
	const channel = {
		close: vi.fn(),
		onmessage: null,
		readyState: "open",
		send: vi.fn(),
	} as unknown as RTCDataChannel;
	const connection = {
		addIceCandidate: vi.fn(async () => undefined),
		addTrack: vi.fn(),
		close: vi.fn(),
		connectionState: "new",
		createDataChannel: vi.fn(() => channel),
		createOffer,
		getSenders: vi.fn(() => []),
		onconnectionstatechange: null,
		onicecandidate: null,
		remoteDescription: null,
		setLocalDescription: vi.fn(async () => undefined),
		signalingState: "stable",
	} as unknown as RTCPeerConnection;
	return { connection, createOffer, channel };
}

function fakeStream(): MediaStream {
	const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
	return {
		getTracks: () => [track],
		getVideoTracks: () => [track],
	} as unknown as MediaStream;
}
