import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import type { ChatConversationItem } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { preserveMessagesAddedAfterSnapshot, shareChatMessageSnapshot } from "./chat-message-snapshot";

function message(id: string, text: string): ChatConversationItem {
	return createConversationAgentMessage({ id, text, blocks: [{ id: `${id}-text`, type: "text", text }] });
}

describe("shareChatMessageSnapshot", () => {
	it("完整等价时保留预览数组与所有消息引用", () => {
		const preview = [message("a", "first"), message("b", "second")];
		const canonical = [message("a", "first"), message("b", "second")];

		const result = shareChatMessageSnapshot(preview, canonical);

		expect(result.messages).toBe(preview);
		expect(result.reusedCount).toBe(2);
	});

	it("只替换 Runtime 中真正变化的消息", () => {
		const preview = [message("a", "first"), message("b", "preview")];
		const canonical = [message("a", "first"), message("b", "canonical"), message("c", "new")];

		const result = shareChatMessageSnapshot(preview, canonical);

		expect(result.messages).not.toBe(preview);
		expect(result.messages[0]).toBe(preview[0]);
		expect(result.messages[1]).toBe(canonical[1]);
		expect(result.messages[2]).toBe(canonical[2]);
		expect(result.reusedCount).toBe(1);
	});

	it("顺序改变时按稳定消息 id 复用，而不错误沿用旧位置", () => {
		const first = message("a", "first");
		const second = message("b", "second");

		const result = shareChatMessageSnapshot([first, second], [message("b", "second"), message("a", "first")]);

		expect(result.messages).toEqual([second, first]);
		expect(result.reusedCount).toBe(2);
	});

	it("Runtime 水合替换预览基线时保留其后接受的乐观消息", () => {
		const preview = [message("a", "preview")];
		const canonical = [message("a", "canonical")];
		const optimistic = createConversationUserMessage({ id: "user-pending", text: "accepted" });

		const result = preserveMessagesAddedAfterSnapshot(preview, canonical, [...preview, optimistic]);

		expect(result).toEqual([...canonical, optimistic]);
	});

	it("延迟回填时不重复追加已被 canonical 对账吸收的消息", () => {
		const queued = createConversationUserMessage({ id: "queued-user", text: "next" });

		const result = preserveMessagesAddedAfterSnapshot([], [queued], [queued]);

		expect(result).toEqual([queued]);
	});

	describe("cross-session history handoff", () => {
		it("keeps a preview message when canonical history has not caught up", () => {
			const preview = [
				createConversationUserMessage({ id: "preview-entry", entryId: "entry-1", text: "still visible" }),
			];
			expect(preserveMessagesAddedAfterSnapshot(preview, [], preview)).toEqual(preview);
		});

		it("does not duplicate a newly sent user message when canonical history assigns its durable id", () => {
			const preview = [createConversationUserMessage({ id: "entry-1", entryId: "entry-1", text: "first" })];
			const optimistic = createConversationUserMessage({ id: "optimistic-2", text: "same prompt" });
			const canonical = [
				...preview,
				createConversationUserMessage({ id: "entry-2", entryId: "entry-2", text: "same prompt" }),
			];
			const result = preserveMessagesAddedAfterSnapshot(preview, canonical, [...preview, optimistic]);
			expect(result.filter((item) => item.kind === "user" && item.text === "same prompt")).toHaveLength(1);
		});

		it("preserves a repeated prompt at a different user ordinal when canonical is still behind", () => {
			const first = createConversationUserMessage({ id: "entry-1", entryId: "entry-1", text: "repeat" });
			const pending = createConversationUserMessage({ id: "optimistic-2", text: "repeat" });
			expect(preserveMessagesAddedAfterSnapshot([first], [first], [first, pending])).toEqual([first, pending]);
		});

		it("keeps a distinct attachment send even when its text matches the canonical message", () => {
			const preview = [createConversationUserMessage({ id: "entry-1", entryId: "entry-1", text: "first" })];
			const persisted = createConversationUserMessage({
				id: "entry-2",
				entryId: "entry-2",
				text: "look here",
				attachments: [{ kind: "file", path: "/first.txt" }],
			});
			const pending = createConversationUserMessage({
				id: "pending-2",
				text: "look here",
				attachments: [{ kind: "file", path: "/second.txt" }],
			});
			expect(preserveMessagesAddedAfterSnapshot(preview, [...preview, persisted], [...preview, pending])).toEqual([
				...preview,
				persisted,
				pending,
			]);
		});
	});
});
