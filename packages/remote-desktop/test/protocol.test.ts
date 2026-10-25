import { describe, expect, it } from "vitest";
import { decodeRemoteDesktopSignal, decodeRemoteInputMessage, RemoteDesktopProtocolError } from "../src/index.js";

describe("remote desktop protocol", () => {
	it("accepts the relay peer-ready event without peer-controlled fields", () => {
		expect(decodeRemoteDesktopSignal({ type: "peer_ready", protocolVersion: 1 })).toEqual({
			type: "peer_ready",
			protocolVersion: 1,
		});
		expect(() =>
			decodeRemoteDesktopSignal({ type: "peer_ready", protocolVersion: 1, sessionId: "injected" }),
		).toThrow("unsupported field: sessionId");
	});

	it("validates normalized pointer input", () => {
		expect(decodeRemoteInputMessage({ type: "pointer.move", sequence: 1, x: 0.25, y: 0.75 })).toEqual({
			type: "pointer.move",
			sequence: 1,
			x: 0.25,
			y: 0.75,
		});
		expect(() => decodeRemoteInputMessage({ type: "pointer.move", sequence: 1, x: 1.1, y: 0 })).toThrow(
			RemoteDesktopProtocolError,
		);
	});

	it("rejects authority-expanding unknown input fields", () => {
		expect(() =>
			decodeRemoteInputMessage({ type: "key", sequence: 1, code: "KeyA", action: "down", text: "secret" }),
		).toThrow("unsupported field: text");
	});
	it("bounds relative pointer motion and keeps the existing absolute contract", () => {
		expect(decodeRemoteInputMessage({ type: "pointer.relative", sequence: 2, deltaX: -12, deltaY: 4 })).toEqual({
			type: "pointer.relative",
			sequence: 2,
			deltaX: -12,
			deltaY: 4,
		});
		for (const deltaX of [NaN, Infinity, 4097])
			expect(() => decodeRemoteInputMessage({ type: "pointer.relative", sequence: 2, deltaX, deltaY: 0 })).toThrow();
		expect(() =>
			decodeRemoteInputMessage({ type: "pointer.relative", sequence: 2, deltaX: 0, deltaY: 0, x: 1 }),
		).toThrow("unsupported field: x");
	});

	it("bounds SDP and validates protocol versions", () => {
		expect(() =>
			decodeRemoteDesktopSignal({ type: "offer", protocolVersion: 2, sessionId: "session", sdp: "v=0" }),
		).toThrow("unsupported desktop protocol version");
		expect(() =>
			decodeRemoteDesktopSignal({
				type: "offer",
				protocolVersion: 1,
				sessionId: "session",
				sdp: "x".repeat(262_145),
			}),
		).toThrow(RemoteDesktopProtocolError);
	});
});

// View feedback is separate from the input-authority contract.
it("bounds optional viewport feedback and rejects authority-expanding fields", async () => {
	const { parseRemoteViewportMessage } = await import("../src/protocol.js");
	expect(parseRemoteViewportMessage({ type: "viewport", sequence: 1, width: 1920, height: 1080 })).toEqual({
		type: "viewport",
		sequence: 1,
		width: 1920,
		height: 1080,
	});
	for (const patch of [{ width: 0 }, { height: Infinity }, { width: 9000 }, { inputEnabled: true }, { sequence: 0 }]) {
		expect(() =>
			parseRemoteViewportMessage({ type: "viewport", sequence: 1, width: 1920, height: 1080, ...patch }),
		).toThrow();
	}
});
