// @vitest-environment jsdom

import { ConfirmDialog } from "@shared/components/ui/confirm-dialog";
import { initI18n } from "@shared/i18n";
import {
	activeSessionAtom,
	activeSessionStreamingAtom,
	chatMessagesAtom,
	confirmDialogAtom,
	goalStateBySessionAtom,
	inputValueAtom,
	isCompactingAtom,
	isReloadingMcpAtom,
	pendingPlanReviewsAtom,
	pendingQuestionsAtom,
	pendingScrollToEntryAtom,
	pendingSessionSendAtom,
	retryProgressAtom,
	sandboxPermissionDrawerAtom,
} from "@shared/store/atoms";
import { dismissToast, toastsAtom } from "@shared/store/toast-atoms";
import { messageQueueBySessionAtom, messageQueuePausedBySessionAtom } from "@shared/store/message-queue-atoms";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionTaskProgress } from "./SessionTaskProgress";

const store = getDefaultStore();
const resume = vi.fn(async () => {});
const session = { runtimeId: "runtime", cwd: "/workspace", sessionPath: "/session.jsonl" };
beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	resume.mockReset();
	resume.mockResolvedValue(undefined);
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: { session: { continue: resume, resumeGoal: vi.fn() } },
	});
	store.set(activeSessionAtom, session);
	store.set(activeSessionStreamingAtom, false);
	store.set(chatMessagesAtom, [
		{
			kind: "agent",
			role: "assistant",
			id: "reply",
			entryId: "entry",
			turnId: "turn",
			authorId: "agent",
			phase: "failed",
			blocks: [{ type: "error", id: "error", kind: "network", text: "Connection closed" }],
		},
	]);
	store.set(goalStateBySessionAtom, {});
	store.set(sandboxPermissionDrawerAtom, null);
	store.set(confirmDialogAtom, null);
	store.set(isCompactingAtom, false);
	store.set(retryProgressAtom, null);
	store.set(pendingSessionSendAtom, null);
	store.set(isReloadingMcpAtom, false);
	store.set(pendingQuestionsAtom, {});
	store.set(pendingPlanReviewsAtom, {});
	store.set(messageQueuePausedBySessionAtom, new Map());
	store.set(messageQueueBySessionAtom, new Map());
	store.set(inputValueAtom, "My unsent draft");
});
afterEach(() => {
	cleanup();
	for (const toast of store.get(toastsAtom)) dismissToast(toast.id);
	vi.restoreAllMocks();
});

it("shows a failed reply, asks before continuing, then keeps history and the unsent draft", async () => {
	render(
		<>
			<SessionTaskProgress />
			<ConfirmDialog />
		</>,
	);
	expect(screen.getByRole("status").textContent).toContain("本轮未完成");
	fireEvent.click(screen.getByRole("button", { name: "查看原因" }));
	expect(store.get(pendingScrollToEntryAtom)).toEqual({ entryId: "entry" });
	fireEvent.click(screen.getByRole("button", { name: "从历史继续" }));
	expect(await screen.findByText("继续这项任务？")).toBeTruthy();
	expect(resume).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "确认继续" }));
	await waitFor(() => expect(resume).toHaveBeenCalledWith("runtime"));
	expect(resume).toHaveBeenCalledTimes(1);
	expect(store.get(inputValueAtom)).toBe("My unsent draft");
	expect(store.get(chatMessagesAtom)[0].id).toBe("reply");
});

it("rejects a confirmation belonging to a conversation that has since changed", async () => {
	render(<SessionTaskProgress />);
	fireEvent.click(screen.getByRole("button", { name: "从历史继续" }));
	const confirmation = store.get(confirmDialogAtom);
	act(() => store.set(activeSessionAtom, { ...session, runtimeId: "other", sessionPath: "/other.jsonl" }));
	await act(async () => confirmation?.onConfirm(false));
	expect(resume).not.toHaveBeenCalled();
	expect(store.get(inputValueAtom)).toBe("My unsent draft");
});

it("deduplicates repeated confirmations and keeps a failed recovery available", async () => {
	let reject: (reason: Error) => void = () => {};
	resume.mockImplementation(
		() =>
			new Promise<void>((_resolve, rejectPromise) => {
				reject = rejectPromise;
			}),
	);
	render(<SessionTaskProgress />);
	fireEvent.click(screen.getByRole("button", { name: "从历史继续" }));
	const confirmation = store.get(confirmDialogAtom);
	act(() => {
		confirmation?.onConfirm(false);
		confirmation?.onConfirm(false);
	});
	await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
	await act(async () => reject(new Error("offline")));
	await waitFor(() => expect(screen.getByRole("button", { name: "从历史继续" }).hasAttribute("disabled")).toBe(false));
	expect(store.get(inputValueAtom)).toBe("My unsent draft");
});

it("shows live compaction and waiting-for-answer states and removes them when stopped", () => {
	act(() => store.set(activeSessionStreamingAtom, true));
	render(<SessionTaskProgress />);
	act(() => store.set(isCompactingAtom, true));
	expect(screen.getByRole("status").textContent).toContain("正在整理上下文");
	const grant = {
		requestId: "grant",
		runtimeId: "other",
		title: "Permission",
		message: "Allow write?",
		onConfirm: () => {},
		onCancel: () => {},
	};
	act(() => store.set(sandboxPermissionDrawerAtom, grant));
	expect(screen.getByRole("status").textContent).toContain("正在整理上下文");
	act(() => store.set(sandboxPermissionDrawerAtom, { ...grant, runtimeId: "runtime" }));
	expect(screen.getByRole("status").textContent).toContain("等待工具授权");
	act(() => store.set(sandboxPermissionDrawerAtom, null));
	act(() =>
		store.set(pendingQuestionsAtom, { runtime: { requestId: "question", sessionId: "runtime", questions: [] } }),
	);
	expect(screen.getByRole("status").textContent).toContain("等待你的回答");
	act(() => {
		store.set(pendingQuestionsAtom, {});
		store.set(isCompactingAtom, false);
		store.set(activeSessionStreamingAtom, false);
	});
	expect(screen.getByRole("status").textContent).toContain("本轮未完成");
});

it("offers an explicit continuation after a completed reply without labeling it verified task success", async () => {
	act(() =>
		store.set(chatMessagesAtom, [
			{
				kind: "agent",
				role: "assistant",
				id: "done",
				turnId: "turn",
				authorId: "agent",
				phase: "completed",
				blocks: [{ type: "text", id: "text", text: "Done" }],
			},
		]),
	);
	render(<SessionTaskProgress />);
	expect(screen.queryByRole("status")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "从历史继续" }));
	expect(resume).not.toHaveBeenCalled();
	act(() => store.get(confirmDialogAtom)?.onConfirm(false));
	await waitFor(() => expect(resume).toHaveBeenCalledWith("runtime"));
	expect(store.get(inputValueAtom)).toBe("My unsent draft");
	expect(store.get(chatMessagesAtom)[0].id).toBe("done");
});
it("respects queued input, but an empty paused queue does not prevent continuing", () => {
	act(() => store.set(messageQueuePausedBySessionAtom, new Map([["runtime", true]])));
	render(<SessionTaskProgress />);
	expect(screen.getByRole("button", { name: "从历史继续" })).toBeTruthy();
	act(() =>
		store.set(
			messageQueueBySessionAtom,
			new Map([["runtime", [{ id: "queued", displayText: "next", behavior: "followUp", kind: "message" }]]]),
		),
	);
	expect(screen.getByRole("status").textContent).toContain("排队输入已暂停");
	expect(screen.queryByRole("button", { name: "从历史继续" })).toBeNull();
});
it("resumes a restored goal through its existing goal controller", async () => {
	const goal = {
		goalId: "goal",
		objective: "Finish the report",
		status: "paused" as const,
		tokensUsed: 10,
		timeUsedSeconds: 1,
		continuationCount: 1,
		createdAt: "2026-10-28T00:00:00Z",
		updatedAt: "2026-10-28T00:00:00Z",
	};
	const resumeGoal = vi.fn(async () => ({ ...goal, status: "active" as const }));
	window.agent567.session.resumeGoal = resumeGoal;
	act(() => store.set(goalStateBySessionAtom, { runtime: goal }));
	render(<SessionTaskProgress />);
	fireEvent.click(screen.getByRole("button", { name: "从历史继续" }));
	act(() => store.get(confirmDialogAtom)?.onConfirm(false));
	await waitFor(() => expect(resumeGoal).toHaveBeenCalledWith("runtime", "goal"));
	expect(resume).not.toHaveBeenCalled();
	expect(store.get(inputValueAtom)).toBe("My unsent draft");
});

it.each(["history", "question"])(
	"notifies when %s changes after confirmation but before the next paint",
	async (change) => {
		const frames: FrameRequestCallback[] = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			frames.push(cb);
			return frames.length;
		});
		render(<SessionTaskProgress />);
		fireEvent.click(screen.getByRole("button", { name: "从历史继续" }));
		act(() => store.get(confirmDialogAtom)?.onConfirm(false));
		expect(resume).not.toHaveBeenCalled();
		act(() => {
			if (change === "history") store.set(chatMessagesAtom, []);
			else
				store.set(pendingQuestionsAtom, {
					runtime: { requestId: "late-question", sessionId: "runtime", questions: [] },
				});
		});
		await act(async () => {
			while (frames.length) frames.shift()?.(0);
		});
		await waitFor(() =>
			expect(store.get(toastsAtom).some((toast) => toast.message === "当前会话或任务状态已变化，请重新确认。")).toBe(
				true,
			),
		);
		expect(resume).not.toHaveBeenCalled();
	},
);
it("keeps stop on the composer and omits a duplicate action from live task information", () => {
	act(() => store.set(activeSessionStreamingAtom, true));
	render(<SessionTaskProgress />);
	expect(screen.getByRole("status")).toBeTruthy();
	expect(screen.queryByRole("button", { name: "停止" })).toBeNull();
});
