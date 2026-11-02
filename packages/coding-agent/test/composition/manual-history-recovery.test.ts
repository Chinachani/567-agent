import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEvent,
	EventStream,
	type Message,
	type Model,
} from "@567agent/ai";
import { expect, it } from "vitest";
import { createCodingAgentRuntimeComposition } from "../fixtures/conversation-persistence.js";

const model: Model<Api> = {
	id: "strict-model",
	name: "Strict model",
	api: "openai-completions",
	provider: "fixture",
	baseUrl: "https://example.test",
	reasoning: true,
	input: ["text"],
	contextWindow: 64000,
	maxTokens: 4096,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

class ResponseStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor(message: AssistantMessage) {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event");
			},
		);
		queueMicrotask(() => {
			if (message.stopReason === "error") this.push({ type: "error", reason: "error", error: message });
			else this.push({ type: "done", reason: message.stopReason as "stop" | "length", message });
		});
	}
}

function response(stopReason: AssistantMessage["stopReason"], text = ""): AssistantMessage {
	return {
		role: "assistant",
		api: model.api,
		provider: model.provider,
		model: model.id,
		content:
			stopReason === "length"
				? [{ type: "thinking", thinking: "Incomplete reasoning" }]
				: text
					? [{ type: "text", text }]
					: [],
		usage: {
			input: 10,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 10,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
		...(stopReason === "error" ? { errorMessage: "Requests ending with a model turn are not supported." } : {}),
	};
}

it("recovers a fork after zero-output length and failed continuation, including after reopening persisted history", async () => {
	const dir = await mkdtemp(join(tmpdir(), "agent567-continue-fork-"));
	const calls: Message[][] = [];
	const composition = await createCodingAgentRuntimeComposition({
		conversationDir: dir,
		initialModel: model,
		initialThinkingLevel: "off",
		activation: { mode: "explicit", toolNames: [] },
		modelRegistry: {
			refresh() {},
			getAvailable: () => [model],
			find: () => model,
			getApiKey: async () => "fixture",
			setServerToken() {},
			loadRemoteModels: async () => undefined,
		},
		streamFn: (_model, context) => {
			calls.push(structuredClone(context.messages));
			if (calls.length === 1) return new ResponseStream(response("stop", "Parent answer"));
			if (calls.length === 2) return new ResponseStream(response("length"));
			if (calls.length === 3) return new ResponseStream(response("error"));
			// Emulate the provider's turn-order contract, using the actual model-call projection.
			expect(context.messages.at(-1)?.role).toBe("user");
			expect(
				context.messages.some((message) => message.role === "assistant" && message.stopReason === "length"),
			).toBe(false);
			return new ResponseStream(response("stop", "Recovered answer"));
		},
	});
	try {
		const parent = await composition.createSession({ sessionId: "parent", cwd: dir, automaticRetry: false });
		await parent.prompt({ text: "Original request" });
		const parentBefore = structuredClone(parent.readMessages());
		const entry = parent.readHistory().find((entry) => entry.type === "message" && entry.message.role === "user");
		if (!entry || entry.type !== "message" || !entry.entryId) throw new Error("Missing parent entry");
		const fork = await parent.forkSession(entry.entryId);
		const header = JSON.parse((await readFile(fork.path, "utf8")).split("\n")[0]) as { sessionId: string };
		let session = await composition.resumeSession({ sessionId: header.sessionId, cwd: dir, automaticRetry: false });
		await expect(session.prompt({ text: "First question after the fork" })).resolves.toMatchObject({
			status: "failed",
			error: { message: expect.stringContaining("length stop") },
		});
		expect(calls).toHaveLength(2); // No automatic paid repeat of the zero-output request.
		await session.continue();
		const before = structuredClone(session.readMessages());
		expect(before.some((message) => message.role === "assistant" && message.stopReason === "error")).toBe(true);
		await session.dispose();
		session = await composition.resumeSession({ sessionId: header.sessionId, cwd: dir, automaticRetry: false });
		await session.continue();
		const after = session.readMessages();
		expect(after.slice(0, before.length)).toEqual(before);
		expect(after.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "Recovered answer" }] });
		expect(after.filter((message) => message.role === "user")).toHaveLength(
			before.filter((message) => message.role === "user").length,
		);
		expect(parent.readMessages()).toEqual(parentBefore);
		await session.dispose();
		await parent.dispose();
	} finally {
		await composition.dispose();
		await rm(dir, { recursive: true, force: true });
	}
});
