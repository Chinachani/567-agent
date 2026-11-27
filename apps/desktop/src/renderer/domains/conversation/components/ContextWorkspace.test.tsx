// @vitest-environment jsdom

import { initI18n } from "@shared/i18n";
import { attachedImagesAtom, mentionedFilesAtom } from "@shared/store/atoms";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { getDefaultStore } from "jotai";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContextWorkspaceSnapshot } from "../../../../shared/context-workspace";
import { ContextWorkspace } from "./ContextWorkspace";
import { filterEvaluatedTurns, summarizeContextWorkspace } from "./context-workspace-summary";

function makeContextSnapshot(overrides: Partial<ContextWorkspaceSnapshot> = {}): ContextWorkspaceSnapshot {
	return {
		sessionId: "session-1",
		documentRevision: 3,
		revision: 1,
		busy: false,
		pinnedText: "",
		excludedTurnIds: ["turn-2"],
		summary: "Earlier decisions summary",
		previousSummary: "Older summary",
		tokensBefore: 1200,
		totalTurns: 3,
		turns: [
			{ id: "turn-1", text: "Older summarized turn", attachments: [], status: "summarized" },
			{ id: "turn-2", text: "Excluded turn content", attachments: ["/work/excluded.txt"], status: "excluded" },
			{ id: "turn-3", text: "Active latest turn details", attachments: ["/work/spec.md"], status: "included" },
		],
		...overrides,
	};
}

describe("summarizeContextWorkspace & filterEvaluatedTurns", () => {
	it("computes next-send counts, unsaved deltas, and summary rebuild impact", () => {
		const snapshot = makeContextSnapshot();
		const initial = summarizeContextWorkspace(snapshot, "", ["turn-2"]);
		expect(initial.includedCount).toBe(1);
		expect(initial.summarizedCount).toBe(1);
		expect(initial.excludedCount).toBe(1);
		expect(initial.changeCount).toBe(0);
		expect(initial.summaryWillRebuild).toBe(false);
		expect(initial.evaluatedTurns.map((entry) => entry.turn.id)).toEqual(["turn-3", "turn-2", "turn-1"]);

		const edited = summarizeContextWorkspace(snapshot, "Keep API stable", ["turn-2", "turn-3"]);
		expect(edited.includedCount).toBe(0);
		expect(edited.excludedCount).toBe(2);
		expect(edited.modifiedTurnCount).toBe(1);
		expect(edited.pinnedChanged).toBe(true);
		expect(edited.changeCount).toBe(2);
		expect(edited.summaryWillRebuild).toBe(true);

		expect(filterEvaluatedTurns(edited.evaluatedTurns, "excluded", "").map((entry) => entry.turn.id)).toEqual([
			"turn-3",
			"turn-2",
		]);
		expect(filterEvaluatedTurns(edited.evaluatedTurns, "all", "spec.md").map((entry) => entry.turn.id)).toEqual([
			"turn-3",
		]);
	});
});

describe("ContextWorkspace", () => {
	beforeAll(async () => {
		initI18n();
		await i18n.changeLanguage("zh");
	});

	afterEach(() => {
		cleanup();
		const store = getDefaultStore();
		store.set(mentionedFilesAtom, []);
		store.set(attachedImagesAtom, []);
		delete (window as { agent567?: unknown }).agent567;
	});

	function setupMockSessionApi(
		snapshot: ContextWorkspaceSnapshot = makeContextSnapshot(),
		onUpdate = vi.fn(async (_sid: string, selection: { pinnedText: string; excludedTurnIds: readonly string[] }) => ({
			...snapshot,
			revision: snapshot.revision + 1,
			pinnedText: selection.pinnedText,
			excludedTurnIds: selection.excludedTurnIds,
		})),
		overrides: Record<string, unknown> = {},
	) {
		const readWorkbench = vi.fn(async () => ({
			attachments: [{ id: "att-1", name: "spec.md", path: "/work/spec.md", kind: "file" as const }],
			tasks: [
				{
					id: "task-1",
					title: "Inspect workspace",
					status: "completed" as const,
					timestamp: 1_700_000_000_000,
					durationMs: 1200,
					toolCount: 2,
				},
			],
			changes: [{ id: "chg-1", path: "src/app.ts", status: "pending" as const, reversible: true }],
		}));
		const readWorkbenchDetail = vi.fn(async () => ({
			kind: "change" as const,
			id: "chg-1",
			title: "src/app.ts",
			text: "@@ -1 +1 @@\n-old\n+new",
			beforeText: "old",
			afterText: "new",
			afterRevision: "rev-1",
			reversible: true,
		}));
		(window as { agent567?: unknown }).agent567 = {
			session: {
				readContextWorkspace: vi.fn(async () => snapshot),
				updateContextSelection: onUpdate,
				readWorkbench,
				readWorkbenchDetail,
				reviewChange: vi.fn(async () => ({ attachments: [], tasks: [], changes: [] })),
				...overrides,
			},
		};
		return { onUpdate, readWorkbench, readWorkbenchDetail };
	}

	it("shows next-send summary, compact expandable turns, unsaved state, and saves selection", async () => {
		const user = userEvent.setup();
		const store = getDefaultStore();
		store.set(mentionedFilesAtom, [{ path: "/work/draft.txt", name: "draft.txt", isDirectory: false }]);
		const { onUpdate } = setupMockSessionApi();

		render(<ContextWorkspace sessionId="session-1" />);
		await user.click(screen.getByRole("button", { name: "会话工作台" }));

		expect(await screen.findByRole("region", { name: "下一次发送会包含" })).toBeTruthy();
		expect(screen.getByText("1 / 3 轮")).toBeTruthy();
		expect(screen.getByText("1 个待发送")).toBeTruthy();
		expect(screen.getByText("保存仅更新后续发送的模型输入（固定信息与回合范围），不会删除聊天记录。")).toBeTruthy();

		// Collapsed turn row hides pin button until expanded.
		expect(screen.queryByRole("button", { name: "固定这段预览" })).toBeNull();
		const detailButtons = screen.getAllByRole("button", { name: "详情" });
		await user.click(detailButtons[1]);
		expect(screen.getByRole("button", { name: "固定这段预览" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "固定这段预览" }));

		// Excluding an active turn marks draft unsaved and warns about summary rebuild.
		const turn3Checkbox = screen.getByRole("checkbox", { name: "Active latest turn details" });
		await user.click(turn3Checkbox);
		expect(screen.getAllByText("未保存草稿").length).toBeGreaterThan(0);
		expect(screen.getByText(/已调整排除范围：保存会失效旧摘要/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "保存本轮范围" }).hasAttribute("disabled")).toBe(false);

		await user.click(screen.getByRole("button", { name: "保存本轮范围" }));
		await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
		expect(onUpdate.mock.calls[0][1].pinnedText).toContain("Active latest turn details");
		expect(onUpdate.mock.calls[0][1].excludedTurnIds).toEqual(["turn-2", "turn-3"]);
	});

	it("locks controls in read-only mode while session is busy", async () => {
		const user = userEvent.setup();
		setupMockSessionApi(makeContextSnapshot({ busy: true }));

		render(<ContextWorkspace sessionId="session-1" />);
		await user.click(screen.getByRole("button", { name: "会话工作台" }));

		expect((await screen.findAllByText("只读")).length).toBeGreaterThan(0);
		// Also check read-only notice and disabled controls
		expect(screen.getAllByText("当前会话正在回复或压缩上下文，暂时只读。").length).toBeGreaterThan(0);
		expect(screen.getByRole("checkbox", { name: "Active latest turn details" }).hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "保存本轮范围" }).hasAttribute("disabled")).toBe(true);
	});

	it("filters turns by status, confirms discarding unsaved edits, and displays change review badges", async () => {
		const user = userEvent.setup();
		setupMockSessionApi();

		render(<ContextWorkspace sessionId="session-1" />);
		await user.click(screen.getByRole("button", { name: "会话工作台" }));
		await screen.findByRole("region", { name: "下一次发送会包含" });

		await user.click(screen.getByRole("button", { name: "已排除 (1)" }));
		expect(screen.getByText("Excluded turn content")).toBeTruthy();
		expect(screen.queryByText("Active latest turn details")).toBeNull();

		await user.click(screen.getByRole("tab", { name: /修改/ }));
		expect(screen.getByText("可撤销")).toBeTruthy();
		expect(screen.getByText("待审阅")).toBeTruthy();

		await user.click(screen.getByRole("tab", { name: /上下文/ }));
		await user.click(screen.getByRole("checkbox", { name: "Excluded turn content" }));
		await user.keyboard("{Escape}");
		expect(screen.getByText("尚有未保存的上下文更改")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "放弃更改" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("opens turn restore from Changes, previews conflicts and applies only after confirmation", async () => {
		const user = userEvent.setup();
		const listTurnFiles = vi.fn(async () => [{ turnId: "turn-1", title: "Edit two files", timestamp: 100, fileCount: 2 }]);
		const previewTurnFiles = vi.fn(async () => ({
			previewId: "preview-1",
			files: [
				{ path: "src/ready.ts", change: "modified", status: "ready" },
				{ path: "src/conflict.ts", change: "modified", status: "conflict" },
			],
		}));
		const restoreTurnFiles = vi.fn(async () => [
			{ path: "src/ready.ts", change: "modified", status: "restored" },
			{ path: "src/conflict.ts", change: "modified", status: "conflict" },
		]);
		setupMockSessionApi(undefined, undefined, { listTurnFiles, previewTurnFiles, restoreTurnFiles });

		render(<ContextWorkspace sessionId="session-1" />);
		await user.click(screen.getByRole("button", { name: "会话工作台" }));
		await user.click(screen.getByRole("tab", { name: /修改/ }));
		expect(listTurnFiles).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "按回合恢复文件" }));
		await user.click(await screen.findByRole("button", { name: /Edit two files/ }));
		expect(await screen.findByText("src/conflict.ts")).toBeTruthy();
		expect(screen.getByText("有冲突，已保留")).toBeTruthy();
		expect(restoreTurnFiles).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "确认恢复 1 个文件" }));
		expect(await screen.findByText("已恢复")).toBeTruthy();
		expect(screen.getByText("有冲突，已保留")).toBeTruthy();
		expect(restoreTurnFiles).toHaveBeenCalledWith("session-1", "preview-1");
	});

	it("retries failed context load, clears search filters, previews pending attachments, and renders task and change details", async () => {
		const user = userEvent.setup();
		const store = getDefaultStore();
		store.set(mentionedFilesAtom, [
			{ path: "/work/draft.txt", name: "draft.txt", isDirectory: false, readScope: "lines 1-20" },
		]);
		store.set(attachedImagesAtom, [
			{ id: "img-1", name: "mockup.png", mimeType: "image/png", data: "aGVsbG8=" },
		]);
		const readContext = vi
			.fn()
			.mockRejectedValueOnce(new Error("transient"))
			.mockResolvedValueOnce(makeContextSnapshot());
		const reviewChange = vi.fn(async () => ({
			attachments: [{ id: "att-1", name: "spec.md", path: "/work/spec.md", kind: "file" as const }],
			tasks: [
				{
					id: "task-1",
					title: "Inspect workspace",
					status: "completed" as const,
					timestamp: 1_700_000_000_000,
					durationMs: 1200,
					toolCount: 2,
				},
			],
			changes: [{ id: "chg-1", path: "src/app.ts", status: "kept" as const, reversible: true }],
		}));
		const readWorkbenchDetail = vi.fn(async (_sid: string, kind: "attachment" | "task" | "change", id: string) => {
			if (kind === "task") {
				return { kind: "task" as const, id, title: "Inspect workspace", text: "" };
			}
			return {
				kind: "change" as const,
				id,
				title: "src/app.ts",
				text: "@@ -1 +1 @@\n-old\n+new",
				beforeText: "old",
				afterText: "new",
				afterRevision: "rev-1",
				reversible: true,
			};
		});
		setupMockSessionApi(makeContextSnapshot(), undefined, {
			readContextWorkspace: readContext,
			readWorkbenchDetail,
			reviewChange,
		});

		render(<ContextWorkspace sessionId="session-1" />);
		await user.click(screen.getByRole("button", { name: "会话工作台" }));

		await user.click(await screen.findByRole("button", { name: "重试" }));
		expect(await screen.findByRole("region", { name: "下一次发送会包含" })).toBeTruthy();

		const searchInput = screen.getByLabelText("搜索回合内容或附件");
		await user.type(searchInput, "nonexistent-query");
		expect(screen.getByText("没有匹配的记录")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "重置筛选" }));
		expect(screen.getByText("Active latest turn details")).toBeTruthy();

		await user.click(screen.getByRole("tab", { name: /附件/ }));
		await user.click(screen.getByRole("button", { name: /mockup\.png/ }));
		expect(screen.getByText("image/png")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: /draft\.txt/ }));
		expect(screen.getByText("10 / 300")).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "清空范围" }));
		expect(screen.getByText("0 / 300")).toBeTruthy();

		await user.click(screen.getByRole("tab", { name: /任务/ }));
		await user.click(screen.getByRole("button", { name: /Inspect workspace/ }));
		expect(await screen.findByText("该任务没有可展示的文本输出或工具结果。")).toBeTruthy();
		expect(screen.getAllByText(/1\.2s · 2 次工具调用/).length).toBe(2);

		await user.click(screen.getByRole("tab", { name: /修改/ }));
		await user.click(screen.getByRole("button", { name: /src\/app\.ts/ }));
		await user.click(await screen.findByRole("button", { name: "保留修改" }));
		await waitFor(() => expect(reviewChange).toHaveBeenCalledWith("session-1", "chg-1", "keep", "rev-1"));
	});
});
