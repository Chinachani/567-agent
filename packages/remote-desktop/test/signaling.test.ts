import { describe, expect, it } from "vitest";
import {
	REMOTE_DESKTOP_WEBSOCKET_PROTOCOL,
	type RemoteDesktopWebSocket,
	WebSocketRemoteDesktopSignaling,
} from "../src/index.js";

describe("desktop signaling websocket", () => {
	it("strips the pairing token from the URL", async () => {
		let url = "";
		let protocols: readonly string[] | undefined;
		const socket = fakeSocket();
		const signaling = new WebSocketRemoteDesktopSignaling(
			"wss://relay.test/v1/desktop/pairing_abcdefghijklmnopqrstuvwx/host#secret_abcdefghijklmnopqrstuvwxyz",
			(nextUrl, nextProtocols) => {
				url = nextUrl;
				protocols = nextProtocols;
				queueMicrotask(() => socket.onopen?.());
				return socket;
			},
		);

		await signaling.connect({ onSignal: () => undefined, onClose: () => undefined });

		expect(url).toBe("wss://relay.test/v1/desktop/pairing_abcdefghijklmnopqrstuvwx/host");
		expect(protocols).toEqual([REMOTE_DESKTOP_WEBSOCKET_PROTOCOL, "vetta.pairing.secret_abcdefghijklmnopqrstuvwxyz"]);
	});

	it("accepts the query-style pairing fragment used by QR pairing", async () => {
		let url = "";
		let protocols: readonly string[] | undefined;
		const socket = fakeSocket();
		const signaling = new WebSocketRemoteDesktopSignaling(
			"wss://relay.test/v1/desktop/pairing_abcdefghijklmnopqrstuvwx/viewer#pairing=mobile_resume&resume=ignored",
			(nextUrl, nextProtocols) => {
				url = nextUrl;
				protocols = nextProtocols;
				queueMicrotask(() => socket.onopen?.());
				return socket;
			},
		);

		await signaling.connect({ onSignal: () => undefined, onClose: () => undefined });

		expect(url).toBe("wss://relay.test/v1/desktop/pairing_abcdefghijklmnopqrstuvwx/viewer");
		expect(protocols).toEqual([REMOTE_DESKTOP_WEBSOCKET_PROTOCOL, "vetta.pairing.mobile_resume"]);
	});

	it("can reconnect after a signaling drop without stale sockets affecting the new connection", async () => {
		const sockets: RemoteDesktopWebSocket[] = [];
		let closes = 0;
		const signaling = new WebSocketRemoteDesktopSignaling("wss://relay.test/host", () => {
			const socket = fakeSocket();
			sockets.push(socket);
			queueMicrotask(() => socket.onopen?.());
			return socket;
		});
		const handlers = {
			onSignal: () => undefined,
			onClose: () => {
				closes += 1;
			},
		};

		await signaling.connect(handlers);
		expect(signaling.connected).toBe(true);
		sockets[0]!.onclose?.({ reason: "relay restarted" });
		expect(signaling.connected).toBe(false);
		expect(closes).toBe(1);

		await signaling.connect(handlers);
		expect(signaling.connected).toBe(true);
		sockets[0]!.onclose?.({ reason: "stale socket" });
		expect(signaling.connected).toBe(true);
		expect(closes).toBe(1);
	});

	it("reports an established signaling socket error as a connection drop", async () => {
		const socket = fakeSocket();
		let closes = 0;
		const signaling = new WebSocketRemoteDesktopSignaling("wss://relay.test/host", () => {
			queueMicrotask(() => socket.onopen?.());
			return socket;
		});
		await signaling.connect({
			onSignal: () => undefined,
			onClose: () => {
				closes += 1;
			},
		});

		socket.onerror?.();

		expect(signaling.connected).toBe(false);
		expect(closes).toBe(1);
	});
});

function fakeSocket(): RemoteDesktopWebSocket {
	return {
		readyState: 0,
		onopen: null,
		onerror: null,
		onclose: null,
		onmessage: null,
		send: () => undefined,
		close: () => undefined,
	};
}
