import { describe, expect, it } from "vitest";
import { CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION } from "../src/public-api/settings.js";

describe("model-call limit configuration", () => {
	it("retains a positive budget while disabled and applies on the next turn", () => {
		expect(CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION.defaultValue).toEqual({ enabled: true, maxCalls: 100 });
		expect(CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION.apply).toBe("next-turn");
		expect(CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION.codec.decode({ enabled: false, maxCalls: 250 })).toEqual({
			enabled: false,
			maxCalls: 250,
		});
	});
	it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "200", null])(
		"rejects invalid call counts: %s",
		(maxCalls) => {
			expect(() => CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION.codec.decode({ enabled: true, maxCalls })).toThrow();
		},
	);
});
