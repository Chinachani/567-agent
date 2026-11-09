import type { Usage } from "@567agent/ai/protocol";

/** Weight throughput by generation time; missing historical timings are never zeros. */
export function summarizeModelPerformance(usages: readonly Usage[]) {
	let recordedCalls = 0;
	let textCalls = 0;
	let speedCalls = 0;
	let durationMs = 0;
	let firstTextMs = 0;
	let generationMs = 0;
	let outputTokens = 0;
	for (const usage of usages) {
		const timing = usage.performance;
		if (!timing || !Number.isFinite(timing.durationMs) || timing.durationMs < 0) continue;
		recordedCalls += 1;
		durationMs += timing.durationMs;
		if (validOffset(timing.firstTextMs, timing.durationMs)) {
			textCalls += 1;
			firstTextMs += timing.firstTextMs;
		}
		if (
			validOffset(timing.firstOutputMs, timing.durationMs) &&
			timing.durationMs > timing.firstOutputMs &&
			Number.isFinite(usage.output) &&
			usage.output > 0
		) {
			speedCalls += 1;
			generationMs += timing.durationMs - timing.firstOutputMs;
			outputTokens += usage.output;
		}
	}
	return {
		recordedCalls,
		textCalls,
		speedCalls,
		totalCalls: usages.length,
		durationMs: recordedCalls > 0 ? durationMs : null,
		firstTextMs: textCalls > 0 ? firstTextMs / textCalls : null,
		tokensPerSecond: generationMs > 0 ? (outputTokens * 1000) / generationMs : null,
	};
}

function validOffset(value: number | undefined, duration: number): value is number {
	return value !== undefined && Number.isFinite(value) && value >= 0 && value <= duration;
}
