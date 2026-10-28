import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteTool } from "@567agent/runtime-node/coding";
import { createConversationAgentMessage } from "@shared/conversation";
import { collectConversationDeliveries } from "@shared/conversation/deliveries";
import { describe, expect, it } from "vitest";
import { extractToolUiDetails, handleToolEnd, handleToolStart, historyToChat } from "./chat-service";

describe("actual output → live transcript → reopened delivery list", () => {
	it("uses the corrected path after a real write and preserves it through the history projection", async () => {
		const directory = await mkdtemp(join(tmpdir(), "agent567-delivery-"));
		try {
			const actual = join(directory, "交付文件-发布稿.txt");
			const deliveryPath = actual.replace(/\\/g, "/");
			await writeFile(actual, "old");
			const input = { path: "交付文件 - 发布稿.txt", content: "new" };
			const tool = createWriteTool(directory, { pathPolicy: { getRejectionReason: () => undefined } });
			const result = await tool.execute({
				sessionId: "session",
				turnId: "turn",
				toolCallId: "call",
				input,
				signal: new AbortController().signal,
			});
			expect(await readFile(actual, "utf8")).toBe("new");
			const live = handleToolEnd(
				handleToolStart(
					[createConversationAgentMessage({ id: "reply", blocks: [], text: "" })],
					"call",
					"write",
					input,
				),
				"call",
				result,
				false,
			);
			expect(collectConversationDeliveries(live, directory)).toMatchObject([
				{ target: deliveryPath, evidence: "written" },
			]);
			const history = JSON.parse(
				JSON.stringify([
					{ role: "assistant", content: [{ type: "toolCall", id: "call", name: "write", arguments: input }] },
					{
						role: "toolResult",
						toolCallId: "call",
						toolName: "write",
						content: result.content,
						details: result.details,
						isError: false,
					},
				]),
			);
			expect(collectConversationDeliveries(historyToChat(history), directory)).toMatchObject([
				{ target: deliveryPath, evidence: "written" },
			]);
			await expect(readFile(deliveryPath, "utf8")).resolves.toBe("new");
			const failed = handleToolEnd(live, "call", result, true);
			expect(collectConversationDeliveries(failed, directory)).toEqual([]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("accepts old change receipts but ignores malformed output metadata", () => {
		expect(extractToolUiDetails(undefined, { fileChange: { version: 1, path: "/old/file.txt" } })).toEqual({
			writtenPath: "/old/file.txt",
		});
		for (const path of [null, 1, "", "bad\0path", "x".repeat(8193)])
			expect(extractToolUiDetails(undefined, { writtenPath: path })).toBeUndefined();
	});
});
