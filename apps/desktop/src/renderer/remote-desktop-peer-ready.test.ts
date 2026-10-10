import { describe, expect, it, vi } from "vitest";
import { handleRemoteDesktopPeerReady } from "./remote-desktop-peer-ready.js";

describe("handleRemoteDesktopPeerReady", () => {
	it("reuses an existing host after signaling reconnect without requesting another capture", async () => {
		const acceptSignal = vi.fn(async () => undefined);
		const requestCapture = vi.fn();

		await handleRemoteDesktopPeerReady({ acceptSignal }, requestCapture);

		expect(acceptSignal).toHaveBeenCalledWith({ type: "peer_ready", protocolVersion: 1 });
		expect(requestCapture).not.toHaveBeenCalled();
	});

	it("requests capture when no host exists yet", async () => {
		const requestCapture = vi.fn();

		await handleRemoteDesktopPeerReady(undefined, requestCapture);

		expect(requestCapture).toHaveBeenCalledOnce();
	});
});
