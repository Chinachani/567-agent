// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForCommittedPaint } from "./committed-paint";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("waitForCommittedPaint", () => {
	it("waits for two animation frames before releasing secondary work", async () => {
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			frames.push(callback);
			return frames.length;
		});
		const barrier = waitForCommittedPaint();
		let result: string | undefined;
		void barrier.then((value) => {
			result = value;
		});

		frames.shift()?.(0);
		await Promise.resolve();
		expect(result).toBeUndefined();
		frames.shift()?.(16);

		await expect(barrier).resolves.toBe("painted");
	});

	it("does not wait for a paint when the window is hidden", async () => {
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
		const requestFrame = vi.spyOn(window, "requestAnimationFrame");

		await expect(waitForCommittedPaint()).resolves.toBe("skipped-hidden");
		expect(requestFrame).not.toHaveBeenCalled();
	});

	it("does not let a timeout bypass a required visible paint", async () => {
		vi.useFakeTimers();
		try {
			vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
			const frames: FrameRequestCallback[] = [];
			vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
				frames.push(callback);
				return frames.length;
			});
			const barrier = waitForCommittedPaint({ timeoutMs: null });
			let settled = false;
			void barrier.then(() => {
				settled = true;
			});

			await vi.advanceTimersByTimeAsync(1_000);
			expect(settled).toBe(false);

			frames.shift()?.(0);
			frames.shift()?.(16);
			await expect(barrier).resolves.toBe("painted");
		} finally {
			vi.useRealTimers();
		}
	});

	it("finishes against its original window when the renderer environment is removed", async () => {
		const owner = window;
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		const schedule = vi.spyOn(owner, "setTimeout");
		vi.spyOn(owner, "requestAnimationFrame").mockReturnValue(7);
		const clearTimeout = vi.spyOn(owner, "clearTimeout");
		const cancelFrame = vi.spyOn(owner, "cancelAnimationFrame");
		const barrier = waitForCommittedPaint({ timeoutMs: 0 });

		vi.stubGlobal("window", undefined);
		await expect(barrier).resolves.toBe("timeout");
		expect(clearTimeout).toHaveBeenCalledWith(schedule.mock.results[0].value);
		expect(cancelFrame).toHaveBeenCalledWith(7);
	});

	it("does not schedule more frames after the timeout has released secondary work", async () => {
		vi.useFakeTimers();
		try {
			vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
			let lateFrame: FrameRequestCallback | undefined;
			const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
				lateFrame = callback;
				return 7;
			});
			const barrier = waitForCommittedPaint();
			await vi.advanceTimersByTimeAsync(100);
			await expect(barrier).resolves.toBe("timeout");

			lateFrame?.(116);
			expect(requestFrame).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});
