import type { ChatConversationItem } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { collectConversationDeliveries } from "./deliveries";

describe("conversation deliveries", () => {
	it("reopens existing history as deduplicated resources, without treating references as verified results", () => {
		const messages: ChatConversationItem[] = [
			{
				kind: "agent",
				role: "assistant",
				id: "answer",
				entryId: "entry",
				turnId: "turn",
				authorId: "agent",
				phase: "completed",
				blocks: [
					{
						type: "text",
						id: "text",
						text: "[Report](./out/report.md)\n[Report again](./out/report.md)\n[Site](https://example.test/)\n[Reference][ref]\n\n[ref]: ./out/data.csv\n\n```md\n[Example](./secret.txt)\n```\n`[inline](./example.txt)`\n![Image](./out/image.png)",
					},
					{
						type: "tool_call",
						toolCallId: "write",
						toolName: "write",
						args: { path: "out/report.md" },
						uiDetails: { writtenPath: "/workspace/out/report.md" },
						status: "success",
						result: "written",
					},
					{
						type: "tool_call",
						toolCallId: "failed",
						toolName: "write",
						args: { path: "bad.txt" },
						status: "error",
						isError: true,
					},
				],
			},
		];
		const items = collectConversationDeliveries(messages, "/workspace");
		expect(items).toHaveLength(4);
		expect(items.find((item) => item.target.endsWith("report.md"))).toMatchObject({
			evidence: "written",
			messageId: "entry",
			turnId: "turn",
		});
		expect(items.find((item) => item.kind === "url")).toMatchObject({ evidence: "reference" });
		expect(items.some((item) => /secret|example.txt|bad.txt/.test(item.target))).toBe(false);
		expect(collectConversationDeliveries(JSON.parse(JSON.stringify(messages)), "/workspace")).toEqual(items);
		const scoped = { ...messages[0], renderKey: "scoped:entry" };
		expect(collectConversationDeliveries([scoped], "/workspace")[0].messageId).toBe("scoped:entry");
	});
	it("keeps current streaming text out of the index and isolates conversations", () => {
		const message: ChatConversationItem = {
			kind: "agent",
			role: "assistant",
			id: "answer",
			turnId: "turn",
			authorId: "agent",
			phase: "streaming",
			blocks: [{ type: "text", id: "text", text: "[File](./unfinished.txt)" }],
		};
		expect(collectConversationDeliveries([message], "/workspace")).toEqual([]);
		expect(collectConversationDeliveries([], "/other")).toEqual([]);
	});
	it("uses the message parser's repaired URLs and rejects active schemes and credentials", () => {
		const message: ChatConversationItem = {
			kind: "agent",
			role: "assistant",
			id: "answer",
			turnId: "turn",
			authorId: "agent",
			phase: "completed",
			blocks: [
				{
					type: "text",
					id: "text",
					text: "https://example.test:8089](https://example.test:8089)\n\n[Bad](javascript:alert) [Credentials](https://user:pass@example.test/)",
				},
			],
		};
		expect(collectConversationDeliveries([message], null).map((item) => item.target)).toEqual([
			"https://example.test:8089",
		]);
	});
	it("uses the repaired table URL in deliveries as well as the visible message", () => {
		const url = "https://a.567.wiki/";
		const message: ChatConversationItem = {
			kind: "agent",
			role: "assistant",
			id: "answer",
			turnId: "turn",
			authorId: "agent",
			phase: "completed",
			blocks: [{ type: "text", id: "text", text: `| Domain |\n| --- |\n| [${url}%5D(${url}) |` }],
		};
		expect(collectConversationDeliveries([message], null).map((item) => item.target)).toEqual([url]);
	});
});

it("does not claim that a tool's image preview was a generated output", () => {
	const message: ChatConversationItem = {
		kind: "agent",
		role: "assistant",
		id: "read",
		turnId: "turn",
		authorId: "agent",
		phase: "completed",
		blocks: [
			{
				type: "tool_call",
				toolCallId: "read",
				toolName: "read",
				args: { path: "input.png" },
				status: "success",
				imagePreview: { originalPath: "/workspace/input.png", data: "fixture", mimeType: "image/png" },
			},
		],
	};
	expect(collectConversationDeliveries([message], "/workspace")).toMatchObject([
		{ kind: "image", evidence: "reference" },
	]);
});
