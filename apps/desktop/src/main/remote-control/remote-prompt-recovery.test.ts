import { describe, expect, it } from "vitest";
import { RemotePromptRecovery } from "./remote-prompt-recovery";

describe("task recovery snapshots", () => {
	it("recovers text, tools, question and terminal state for the matching task only", () => {
		const recovery = new RemotePromptRecovery();
		recovery.start("t", "s", "fingerprint");
		recovery.record("t", { type: "delta", text: "Hello" });
		recovery.record("t", { type: "input", payload: { requestId: "q", questions: [] } });
		expect(recovery.read("t", "other")).toEqual({ found: false });
		expect(recovery.read("t", "s")).toMatchObject({ text: "Hello", input: { requestId: "q" }, truncated: false });
		recovery.answered("other", "q");
		expect(recovery.read("t", "s")).toMatchObject({ input: { requestId: "q" } });
		recovery.answered("s", "q");
		expect(recovery.read("t", "s")).toMatchObject({ input: null });
		recovery.record("t", { type: "state", payload: { state: "completed" } });
		expect(recovery.read("t", "s")).toMatchObject({ state: "completed", input: null });
	});
	it("bounds the complete serialized frame including escaped text and all tools", () => {
		const recovery = new RemotePromptRecovery();
		recovery.start("t", "s", "fingerprint");
		recovery.record("t", { type: "delta", text: '\\"汉😀'.repeat(200_000) });
		for (let i = 0; i < 32; i++)
			recovery.record("t", {
				type: "tool",
				payload: { toolCallId: `tool-${i}`, detail: "x".repeat(8000), result: "y".repeat(8000) },
			});
		recovery.record("t", { type: "input", payload: { requestId: "q", questions: [] } });
		const response = recovery.read("t", "s");
		expect(
			Buffer.byteLength(
				JSON.stringify({ type: "response", payload: response, eventCursor: { publisherId: "p", sequence: 3 } }),
			),
		).toBeLessThan(1_048_576);
		expect(response).toMatchObject({ truncated: true, input: { requestId: "q" } });
		recovery.record("t", { type: "state", payload: { state: "completed" } });
		expect(recovery.read("t", "s")).toMatchObject({ truncated: true, state: "completed" });
	});
});
