import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@567agent/ai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ home: "" }));
vi.mock("@567agent/action-rpc", () => ({ getAgent567HomePath: () => fixture.home }));
vi.mock("electron", () => ({
	safeStorage: { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "gnome_libsecret" },
}));
beforeEach(() => {
	vi.resetModules();
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-24T00:00:00Z"));
	fixture.home = mkdtempSync(join(tmpdir(), "567-inference-"));
	mkdirSync(join(fixture.home, "desktop-app"));
	writeFileSync(
		join(fixture.home, "desktop-app/device-fingerprint.id"),
		"fixture-device-fingerprint-0000000000000000",
	);
});
afterEach(() => {
	vi.useRealTimers();
	rmSync(fixture.home, { recursive: true, force: true });
});
const model: Model<"openai-completions"> = {
	api: "openai-completions",
	provider: "567api",
	id: "test",
	name: "Test",
	baseUrl: "https://api.567.wiki/v1",
	input: ["text"],
	contextWindow: 8192,
	maxTokens: 100,
	reasoning: false,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	headers: { "X-567-Group": "default", "x-567-timestamp": "old", "X-567-Nonce": "frozen", "X-567-Signature": "old" },
};
function reply() {
	return new Response(
		'data: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}\n\ndata: {"id":"fixture","object":"chat.completion.chunk","created":1,"model":"test","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\ndata: [DONE]\n\n',
		{ headers: { "content-type": "text/event-stream" } },
	);
}

it("signs actual OpenAI requests afresh across turns while preserving group, auth, stream and usage", async () => {
	const sent: Headers[] = [];
	const fetcher: typeof fetch = async (input, init) => {
		sent.push(new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)));
		return reply();
	};
	const { createApi567InferenceStream } = await import("./inference.js");
	const stream = createApi567InferenceStream();
	for (let i = 0; i < 2; i++) {
		const result = await stream(
			model,
			{ messages: [{ role: "user", content: "fixture", timestamp: 1 }] },
			{ apiKey: "sk-fixture", fetch: fetcher, headers: { "X-567-Group": "wrong", "x-567-nonce": "stale-option" } },
		).result();
		expect(result.stopReason).toBe("stop");
		expect(result.content).toEqual([{ type: "text", text: "ok" }]);
		expect(result.usage.input).toBe(2);
		vi.setSystemTime(Date.now() + 10000);
	}
	expect(sent).toHaveLength(2);
	expect(sent[0].get("x-567-group")).toBe("default");
	expect(sent[0].get("authorization")).toBe("Bearer sk-fixture");
	expect(sent[0].get("x-567-timestamp")).not.toBe(sent[1].get("x-567-timestamp"));
	expect(sent[0].get("x-567-nonce")).not.toBe(sent[1].get("x-567-nonce"));
	expect(sent[0].get("x-567-signature")).not.toBe(sent[1].get("x-567-signature"));
	expect(model.headers?.["X-567-Nonce"]).toBe("frozen");
});

it("refreshes signatures on repeated transport attempts and refuses origin changes", async () => {
	const sent: Headers[] = [];
	const fetcher: typeof fetch = async (_input, init) => {
		sent.push(new Headers(init?.headers));
		return new Response("ok");
	};
	const { withApi567InferenceOptions } = await import("./inference.js");
	const signal = new AbortController().signal;
	const opts = withApi567InferenceOptions(model, { fetch: fetcher, signal })!;
	await opts.fetch!("https://api.567.wiki/v1/chat/completions", {
		method: "POST",
		headers: { Authorization: "Bearer fixture" },
		body: "{}",
		signal,
	});
	await opts.fetch!("https://api.567.wiki/v1/chat/completions", {
		method: "POST",
		headers: { Authorization: "Bearer fixture" },
		body: "{}",
		signal,
	});
	expect(sent[0].get("x-567-nonce")).not.toBe(sent[1].get("x-567-nonce"));
	await expect(opts.fetch!("https://untrusted.test/v1/chat/completions")).rejects.toThrow();
	expect(sent).toHaveLength(2);
	expect(opts.signal).toBe(signal);
});

it("leaves custom providers and gateways outside managed origins untouched", async () => {
	const { withApi567InferenceOptions } = await import("./inference.js");
	const options = { apiKey: "fixture", headers: { "X-Custom": "kept" } };
	expect(withApi567InferenceOptions({ ...model, provider: "custom" }, options)).toBe(options);
	expect(withApi567InferenceOptions({ ...model, gatewayUrl: "https://private.test/v1" }, options)).toBe(options);
});

it("regenerates the nonce when the real SDK retries an HTTP attempt", async () => {
	const sent: Headers[] = [];
	let first!: () => void;
	const received = new Promise<void>((resolve) => {
		first = resolve;
	});
	const fetcher: typeof fetch = async (_input, init) => {
		sent.push(new Headers(init?.headers));
		if (sent.length === 1) {
			first();
			return new Response('{"error":{"message":"fixture retry"}}', {
				status: 503,
				headers: { "retry-after-ms": "1" },
			});
		}
		return reply();
	};
	const { createApi567InferenceStream } = await import("./inference.js");
	const result = createApi567InferenceStream()(
		model,
		{ messages: [] },
		{ apiKey: "sk-fixture", fetch: fetcher, maxRetries: 1 },
	).result();
	await received;
	await vi.advanceTimersByTimeAsync(10);
	expect((await result).stopReason).toBe("stop");
	expect(sent).toHaveLength(2);
	expect(sent[0].get("x-567-nonce")).not.toBe(sent[1].get("x-567-nonce"));
});

it("uses the real Responses SDK with managed signatures, tool completion and usage", async () => {
	const sent: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
	const message = {
		type: "message",
		id: "msg_1",
		role: "assistant",
		status: "completed",
		content: [{ type: "output_text", text: "ok", annotations: [] }],
	};
	const tool = {
		type: "function_call",
		id: "fc_1",
		call_id: "call_1",
		name: "lookup",
		arguments: '{"value":"test"}',
		status: "completed",
	};
	const events = [
		{ type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
		{ type: "response.output_text.delta", item_id: "msg_1", output_index: 0, content_index: 0, delta: "ok" },
		{ type: "response.output_item.done", output_index: 0, item: message },
		{ type: "response.output_item.added", output_index: 1, item: { ...tool, status: "in_progress", arguments: "" } },
		{ type: "response.function_call_arguments.delta", item_id: "fc_1", output_index: 1, delta: tool.arguments },
		{ type: "response.output_item.done", output_index: 1, item: tool },
		{
			type: "response.completed",
			response: {
				id: "resp_1",
				status: "completed",
				output: [message, tool],
				usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 },
			},
		},
	];
	const fetcher: typeof fetch = async (input, init) => {
		sent.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
		return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
			headers: { "content-type": "text/event-stream" },
		});
	};
	const { createApi567InferenceStream } = await import("./inference.js");
	for (let i = 0; i < 2; i++) {
		const result = await createApi567InferenceStream()(
			{ ...model, id: "gpt-codex", api: "openai-responses" },
			{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
			{ apiKey: "sk-fixture", fetch: fetcher },
		).result();
		expect(result.stopReason).toBe("toolUse");
		expect(result.content).toContainEqual({ type: "text", text: "ok", textSignature: "msg_1" });
		expect(result.content).toContainEqual(
			expect.objectContaining({ type: "toolCall", name: "lookup", arguments: { value: "test" } }),
		);
		expect(result.usage.input).toBe(4);
	}
	expect(sent.every((request) => request.url.endsWith("/v1/responses"))).toBe(true);
	expect(sent[0].body.store).toBe(false);
	expect(sent[0].headers.get("x-567-group")).toBe("default");
	expect(sent[0].headers.get("authorization")).toBe("Bearer sk-fixture");
	expect(sent[0].headers.get("x-567-nonce")).not.toBe(sent[1].headers.get("x-567-nonce"));
});
