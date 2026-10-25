import { expect, it, vi } from "vitest";
import { RemoteDesktopCapture } from "./remote-desktop-capture.js";

function media() {
	const tracks: { readyState: string; stop: () => void }[] = [];
	function stream(): MediaStream {
		const track = {
			readyState: "live",
			stop: vi.fn(() => {
				track.readyState = "ended";
			}),
		};
		tracks.push(track);
		return { getTracks: () => [track], getVideoTracks: () => [track], clone: stream } as unknown as MediaStream;
	}
	return { stream: stream(), tracks };
}

it("a remembered grant survives phone disconnect and route replacement, but explicit close stops every track", async () => {
	const source = media();
	const request = vi.fn(async () => source.stream);
	const capture = new RemoteDesktopCapture(request);
	capture.setRetained(true);
	const first = await capture.acquire();
	capture.release(first);
	expect(source.tracks[0].readyState).toBe("live");
	const next = await capture.acquire();
	expect(next).not.toBe(first);
	expect(request).toHaveBeenCalledOnce();
	capture.close();
	expect(source.tracks.every((track) => track.readyState === "ended")).toBe(true);
	await expect(capture.acquire()).rejects.toThrow("revoked");
});

it("parallel routes share one pending system prompt; revocation rejects both late grants", async () => {
	const source = media();
	let allow!: (stream: MediaStream) => void;
	const request = vi.fn(
		() =>
			new Promise<MediaStream>((resolve) => {
				allow = resolve;
			}),
	);
	const capture = new RemoteDesktopCapture(request);
	const first = capture.acquire();
	const second = capture.acquire();
	capture.close();
	allow(source.stream);
	await expect(first).rejects.toThrow("revoked");
	await expect(second).rejects.toThrow("revoked");
	expect(request).toHaveBeenCalledOnce();
	expect(source.tracks[0].readyState).toBe("ended");
});

it("a one-time grant and a disabled remember option release the OS capture when unused", async () => {
	const source = media();
	const capture = new RemoteDesktopCapture(async () => source.stream);
	capture.setRetained(true);
	const lease = await capture.acquire();
	capture.setRetained(false);
	expect(source.tracks[0].readyState).toBe("live");
	capture.release(lease);
	expect(source.tracks[0].readyState).toBe("ended");
});

it("requests new system consent after the remembered capture ends and can retry a cancelled request", async () => {
	const previous = media();
	const next = media();
	const denied = new DOMException("System sharing was cancelled", "NotAllowedError");
	const request = vi
		.fn()
		.mockResolvedValueOnce(previous.stream)
		.mockRejectedValueOnce(denied)
		.mockResolvedValueOnce(next.stream);
	const capture = new RemoteDesktopCapture(request);
	capture.setRetained(true);
	const lease = await capture.acquire();
	capture.release(lease);
	previous.tracks[0].stop(); // The operating system ends the previously authorized source.
	await expect(capture.acquire()).rejects.toBe(denied);
	const renewed = await capture.acquire();
	expect(request).toHaveBeenCalledTimes(3);
	expect(renewed.getVideoTracks()[0].readyState).toBe("live");
	capture.close();
});
