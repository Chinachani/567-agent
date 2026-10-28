import type { ChatConversationItem } from "@shared/store/atoms";
import { describe, expect, it } from "vitest";
import { projectTaskProgress } from "./task-progress";

const reply = (phase: "streaming" | "failed" | "aborted" | "completed" = "streaming"): ChatConversationItem => ({
	kind: "agent",
	role: "assistant",
	id: "reply",
	turnId: "turn",
	authorId: "agent",
	phase,
	blocks: [{ type: "text", id: "text", text: "Working" }],
});

describe("task progress from canonical conversation facts", () => {
	it("follows waiting, output, tool, approval, compaction and retry without claiming task completion", () => {
		expect(projectTaskProgress({ messages: [], busy: true })?.phase).toBe("waiting");
		const message = reply();
		const messages = [message];
		expect(projectTaskProgress({ messages, busy: true })?.phase).toBe("responding");
		if (message.kind !== "agent") throw new Error("fixture");
		message.blocks.push({ type: "tool_call", toolName: "bash", toolCallId: "call", args: {}, status: "pending" });
		expect(projectTaskProgress({ messages, busy: true })?.phase).toBe("tool");
		expect(projectTaskProgress({ messages, busy: true, question: true })?.phase).toBe("question");
		expect(projectTaskProgress({ messages, busy: true, approval: true })?.phase).toBe("approval");
		expect(projectTaskProgress({ messages, busy: true, compacting: true })?.phase).toBe("compacting");
		expect(
			projectTaskProgress({ messages, busy: true, retry: { attempt: 1, maxAttempts: 3, errorMessage: "network" } })
				?.phase,
		).toBe("retrying");
		message.phase = "completed";
		expect(projectTaskProgress({ messages, busy: false })).toMatchObject({
			phase: "replyComplete",
			canContinue: true,
		});
	});
	it("offers explicit recovery for a failed/stopped reply, but protects persistence failure and paused input queues", () => {
		const message = reply("failed");
		expect(projectTaskProgress({ messages: [message], busy: false })?.canContinue).toBe(true);
		expect(projectTaskProgress({ messages: [message], busy: false, queuePaused: true })?.canContinue).toBe(false);
		if (message.kind !== "agent") throw new Error("fixture");
		message.blocks.push({
			type: "error",
			id: "error",
			text: "Cannot persist",
			kind: "unknown",
			details: { code: "TURN_PERSISTENCE" },
		});
		expect(projectTaskProgress({ messages: [message], busy: false })?.canContinue).toBe(false);
		expect(projectTaskProgress({ messages: [reply()], busy: false })?.phase).toBe("stopped");
		expect(projectTaskProgress({ messages: [reply("aborted")], busy: false })?.phase).toBe("stopped");
	});
	it("does not revive an old failure when the user has started a new turn or opened an empty conversation", () => {
		const messages: ChatConversationItem[] = [
			reply("failed"),
			{
				kind: "user",
				role: "user",
				id: "next",
				turnId: "next",
				authorId: "user",
				deliveryPhase: "completed",
				text: "next",
			},
		];
		expect(projectTaskProgress({ messages, busy: true })).toMatchObject({ phase: "waiting", canContinue: false });
		expect(projectTaskProgress({ messages: [], busy: false })).toBeNull();
	});
	it("distinguishes a terminal tool failure from an earlier error the assistant has already handled", () => {
		const message = reply("completed");
		if (message.kind !== "agent") throw new Error("fixture");
		message.blocks.push({ type: "tool_call", toolCallId: "tool", toolName: "bash", args: {}, status: "error" });
		expect(projectTaskProgress({ messages: [message], busy: false })).toMatchObject({
			phase: "failed",
			canContinue: true,
		});
		message.blocks.push({
			type: "text",
			id: "handled",
			text: "Explained the failed check and completed the requested report.",
		});
		expect(projectTaskProgress({ messages: [message], busy: false })?.phase).toBe("replyComplete");
	});
});
