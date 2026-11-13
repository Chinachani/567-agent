import type { RemoteDesktopWebSocket } from "@567agent/remote-desktop";
import { afterEach, expect, it, vi } from "vitest";
import { RemoteDesktopCapture } from "./remote-desktop-capture.js";
import { RemoteDesktopRoute } from "./remote-desktop-route.js";

afterEach(() => vi.useRealTimers());

it("reconnects a viewer through real signaling and peer orchestration without ending the new session", async () => {
	vi.useFakeTimers();
	const sockets: (RemoteDesktopWebSocket & { sent: string[] })[] = [];
	const peers: RTCPeerConnection[] = [];
	const input = vi.fn();
	const capture = new RemoteDesktopCapture(async () => stream());
	capture.setRetained(true);
	let start: Promise<void> | undefined;
	const route = new RemoteDesktopRoute({
		target: "wss://relay.test/v1/desktop/pairing_abcdefghijklmnopqrstuvwx/host#secret",
		sessionId: "pairing_abcdefghijklmnopqrstuvwx",
		capture,
		requestCapture: () => {
			start = route.startHost();
		},
		onInput: input,
		logger: { info: () => {}, debug: () => {}, warn: () => {} },
		createSocket: () => {
			const socket = {
				readyState: 1,
				onopen: null,
				onclose: null,
				onerror: null,
				onmessage: null,
				sent: [] as string[],
				send(data: string) {
					this.sent.push(data);
				},
				close() {},
			} as RemoteDesktopWebSocket & { sent: string[] };
			sockets.push(socket);
			queueMicrotask(() => socket.onopen?.());
			return socket;
		},
		createPeerConnection: () => {
			const channel = { close() {}, send() {}, readyState: "open" };
			const peer = {
				connectionState: "new",
				signalingState: "stable",
				remoteDescription: null,
				createOffer: async () => ({ type: "offer", sdp: "v=0\r\n" }),
				setLocalDescription: async () => {},
				addTrack() {},
				getSenders: () => [],
				createDataChannel: () => channel,
				close() {
					Object.assign(peer, { connectionState: "closed" });
					peer.onconnectionstatechange?.(new Event("connectionstatechange"));
				},
				onconnectionstatechange: null,
			} as unknown as RTCPeerConnection;
			peers.push(peer);
			return peer;
		},
	});
	const ready = () =>
		sockets.at(-1)!.onmessage?.({ data: JSON.stringify({ type: "peer_ready", protocolVersion: 1 }) });
	try {
		await route.connect();
		ready();
		await start;
		expect(sockets[0]!.sent.map((raw) => JSON.parse(raw).type)).toEqual(["offer"]);
		Object.assign(peers[0]!, { connectionState: "connected" });
		// The old viewer leaves; its direct peer remains connected briefly.
		sockets[0]!.onclose?.({ reason: "Viewer disconnected" });
		await vi.advanceTimersByTimeAsync(2_000);
		ready();
		await Promise.resolve();
		Object.assign(peers[0]!, { connectionState: "disconnected" });
		peers[0]!.onconnectionstatechange?.(new Event("connectionstatechange"));
		await start;
		expect(sockets[1]!.sent.map((raw) => JSON.parse(raw).type)).toEqual(["offer"]);
		expect(peers).toHaveLength(2);
		// Late callbacks and old socket events cannot retire the replacement.
		peers[0]!.onconnectionstatechange?.(new Event("connectionstatechange"));
		sockets[0]!.onclose?.({ reason: "stale" });
		expect(peers).toHaveLength(2);
		expect(peers[1]!.connectionState).toBe("new");
		// A genuine viewer end releases the route; the next join creates a new offer.
		sockets[1]!.onmessage?.({
			data: JSON.stringify({
				type: "end",
				protocolVersion: 1,
				sessionId: "pairing_abcdefghijklmnopqrstuvwx",
				reason: "completed",
			}),
		});
		ready();
		await start;
		expect(peers).toHaveLength(3);
		expect(sockets[1]!.sent.map((raw) => JSON.parse(raw).type)).toEqual(["offer", "offer"]);
	} finally {
		route.close();
		capture.close();
	}
});

function stream(): MediaStream {
	const track = { readyState: "live", stop() {} } as unknown as MediaStreamTrack;
	return { getTracks: () => [track], getVideoTracks: () => [track], clone: stream } as unknown as MediaStream;
}
