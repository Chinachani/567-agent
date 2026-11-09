import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantMessage } from "../src/protocol/index.js";
import { LanguageModelStream, normalizeLanguageModelResponse } from "../src/runtime/language-model-adapter.js";
import { createModelCallMetadataFromMessage } from "../src/runtime/model-call-result.js";
import type { Model } from "../src/types.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";

const model: Model<"openai-responses"> = {
	id: "test",
	name: "test",
	api: "openai-responses",
	provider: "test",
	baseUrl: "https://example.invalid",
	reasoning: true,
	input: ["text"],
	contextWindow: 1000,
	maxTokens: 100,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

afterEach(() => vi.restoreAllMocks());

describe("model call timing", () => {
	it.each([LanguageModelStream, AssistantMessageEventStream])(
		"preserves frozen adapter snapshots and ignores events after completion (%s)",
		async (Stream) => {
			const stream = new Stream();
			const message = createAssistantMessage({ ...model, model: model.id });
			Object.freeze(message.usage);
			stream.push({ type: "done", reason: "stop", message });
			expect(await stream.result()).toBe(message);
			expect(message.usage.performance).toBeUndefined();
			const late = createAssistantMessage({ ...model, model: model.id });
			stream.push({ type: "done", reason: "stop", message: late });
			expect(late.usage.performance).toBeUndefined();
		},
	);

	it.each([LanguageModelStream, AssistantMessageEventStream])(
		"records producer time and preserves it through delayed consumers (%s)",
		async (Stream) => {
			let now = 100;
			vi.spyOn(performance, "now").mockImplementation(() => now);
			const source = new Stream();
			const message = createAssistantMessage({ ...model, model: model.id });
			message.usage.output = 40;
			now = 200;
			source.push({ type: "text_delta", contentIndex: 0, delta: "", partial: message });
			now = 500;
			source.push({ type: "thinking_delta", contentIndex: 0, delta: "thinking", partial: message });
			now = 1100;
			source.push({ type: "text_delta", contentIndex: 1, delta: "answer", partial: message });
			now = 2500;
			source.push({ type: "done", reason: "stop", message });
			now = 9000;
			const response = normalizeLanguageModelResponse(
				{
					events: source,
					result: source.result(),
					metadata: source.result().then(createModelCallMetadataFromMessage),
				},
				model,
			);
			const result = await response.result;
			expect(result.usage.performance).toEqual({ durationMs: 2400, firstOutputMs: 400, firstTextMs: 1000 });
			expect((await response.metadata)?.usage?.performance).toEqual(result.usage.performance);
			expect(JSON.parse(JSON.stringify(result)).usage.performance).toEqual(result.usage.performance);
			expect(result.usage.output).toBe(40);
		},
	);

	it("keeps tool-only calls without a fabricated first text", async () => {
		let now = 0;
		vi.spyOn(performance, "now").mockImplementation(() => now);
		const stream = new LanguageModelStream();
		const message = createAssistantMessage({ ...model, model: model.id });
		message.content.push({ type: "toolCall", id: "call", name: "read", arguments: {} });
		now = 100;
		stream.push({ type: "toolcall_start", contentIndex: 0, partial: message });
		now = 300;
		stream.push({ type: "done", reason: "toolUse", message });
		expect((await stream.result()).usage.performance).toEqual({ durationMs: 300, firstOutputMs: 100 });
	});

	it.each(["error", "aborted"] as const)("does not record %s as a successful timing sample", async (reason) => {
		const stream = new AssistantMessageEventStream();
		const message = createAssistantMessage({ ...model, model: model.id }, { stopReason: reason });
		stream.push({ type: "error", reason, error: message });
		expect((await stream.result()).usage.performance).toBeUndefined();
	});
});
