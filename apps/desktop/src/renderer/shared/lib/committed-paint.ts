export type PaintBarrierResult = "painted" | "skipped-hidden" | "timeout";

export interface CommittedPaintOptions {
	/** Set to `null` when secondary work must never bypass a visible paint. */
	timeoutMs?: number | null;
}

/**
 * Let React commit and the browser present the current UI before starting
 * secondary work that can contend for the renderer or main-process event loop.
 */
export function waitForCommittedPaint({ timeoutMs = 100 }: CommittedPaintOptions = {}): Promise<PaintBarrierResult> {
	if (document.visibilityState === "hidden") return Promise.resolve("skipped-hidden");
	const owner = window;
	if (typeof owner.requestAnimationFrame !== "function") {
		return new Promise((resolve) => owner.setTimeout(() => resolve("timeout"), 0));
	}
	return new Promise((resolve) => {
		let settled = false;
		let frameId: number | null = null;
		const finish = (result: PaintBarrierResult): void => {
			if (settled) return;
			settled = true;
			if (timeoutId !== null) owner.clearTimeout(timeoutId);
			if (frameId !== null) owner.cancelAnimationFrame(frameId);
			resolve(result);
		};
		const timeoutId = timeoutMs === null ? null : owner.setTimeout(() => finish("timeout"), timeoutMs);
		frameId = owner.requestAnimationFrame(() => {
			if (settled) return;
			frameId = owner.requestAnimationFrame(() => {
				frameId = null;
				finish("painted");
			});
		});
	});
}
