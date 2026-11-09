import type { Usage } from "@567agent/ai/protocol";
import { describe, expect, it } from "vitest";
import { summarizeModelPerformance } from "./model-performance";

function usage(output: number, performance?: Usage["performance"]): Usage {
	return {
		input: 0,
		output,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: output,
		performance,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

describe("model performance summary", () => {
	it("weights TPS by generation time and excludes old unmeasured calls", () => {
		expect(
			summarizeModelPerformance([
				usage(100, { durationMs: 2000, firstOutputMs: 1000, firstTextMs: 1500 }),
				usage(100, { durationMs: 10000, firstOutputMs: 1000, firstTextMs: 2500 }),
				usage(9000),
			]),
		).toEqual({
			recordedCalls: 2,
			textCalls: 2,
			speedCalls: 2,
			totalCalls: 3,
			durationMs: 12000,
			firstTextMs: 2000,
			tokensPerSecond: 20,
		});
	});
	it("keeps missing, invalid, and zero-interval throughput unavailable", () => {
		expect(summarizeModelPerformance([usage(10)])).toMatchObject({
			durationMs: null,
			firstTextMs: null,
			tokensPerSecond: null,
		});
		expect(
			summarizeModelPerformance([
				usage(10, { durationMs: 100, firstOutputMs: 100, firstTextMs: 200 }),
				usage(100, { durationMs: Number.NaN }),
			]),
		).toMatchObject({ recordedCalls: 1, durationMs: 100, firstTextMs: null, tokensPerSecond: null });
	});
});
