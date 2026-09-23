import { describe, expect, it } from "vitest";
import { mapClaudeThinkingLevelToEffort, supportsClaudeAdaptiveThinking } from "../src/providers/claude-thinking.js";

describe("Claude thinking support", () => {
	it.each([
		"claude-opus-4-6",
		"claude-sonnet-4.6",
		"claude-opus-4-7-20260101",
		"claude-sonnet-5",
		"claude-fable-5-1",
		"global.anthropic.claude-opus-5-v1",
		"claude-mythos-preview",
	])("uses adaptive thinking for %s", (id) => {
		expect(supportsClaudeAdaptiveThinking(id)).toBe(true);
	});

	it.each([
		"claude-sonnet-4-5",
		"claude-opus-4-20250514",
		"claude-3-7-sonnet-20250219",
		"global.anthropic.claude-sonnet-4-5-v1:0",
		"kimi-k2",
		"future-model",
	])("keeps token budgets for %s", (id) => {
		expect(supportsClaudeAdaptiveThinking(id)).toBe(false);
	});

	it("maps xhigh to max only for supported Opus versions", () => {
		expect(mapClaudeThinkingLevelToEffort("xhigh", "claude-opus-4-7")).toBe("max");
		expect(mapClaudeThinkingLevelToEffort("xhigh", "claude-opus-5")).toBe("max");
		expect(mapClaudeThinkingLevelToEffort("xhigh", "claude-sonnet-5")).toBe("high");
		expect(mapClaudeThinkingLevelToEffort("xhigh", "claude-opus-4-5")).toBe("high");
	});
});
