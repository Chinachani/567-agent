// @vitest-environment jsdom

import { initI18n } from "@shared/i18n";
import { activeSessionAtom, chatMessagesAtom, filePreviewAtom, pendingScrollToEntryAtom } from "@shared/store/atoms";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ActivityPanelContextProvider } from "../registry/context";
import { ConversationDeliveries } from "./ConversationDeliveries";

const store = getDefaultStore();
const copy = vi.fn(async () => {});
beforeEach(async () => {
	initI18n();
	copy.mockClear();
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copy } });
	await i18n.changeLanguage("zh");
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: { shell: { openExternal: async () => {} } },
	});
	store.set(activeSessionAtom, { runtimeId: "runtime", cwd: "/workspace", sessionPath: "/session.jsonl" });
	store.set(pendingScrollToEntryAtom, null);
	store.set(chatMessagesAtom, [
		{
			kind: "agent",
			role: "assistant",
			id: "reply",
			entryId: "entry",
			turnId: "turn",
			authorId: "agent",
			phase: "completed",
			blocks: [{ type: "text", id: "text", text: "[Report](./report.md)\n[Website](https://example.test/)" }],
		},
	]);
});
afterEach(cleanup);

it("collects an old conversation, opens the existing preview and jumps to its source without changing history", async () => {
	const view = render(
		<ActivityPanelContextProvider
			value={{
				workspace: { id: "/workspace", cwd: "/workspace", runtimeIds: ["runtime"] },
				knowledgeHistory: false,
			}}
		>
			<ConversationDeliveries />
		</ActivityPanelContextProvider>,
	);
	expect(screen.getByText("正在从会话历史整理文件与链接…")).toBeTruthy();
	await waitFor(() => expect(screen.getAllByText("对话引用 · 未验证")).toHaveLength(2));
	fireEvent.click(screen.getByRole("button", { name: /^Report/ }));
	expect(store.get(filePreviewAtom)).toMatchObject({ name: "report.md", path: "/workspace/report.md" });
	fireEvent.click(screen.getAllByRole("button", { name: "查看来源" })[0]);
	expect(store.get(pendingScrollToEntryAtom)).toEqual({ entryId: "entry" });
	expect(store.get(chatMessagesAtom)).toHaveLength(1);
	fireEvent.click(screen.getByRole("button", { name: "复制路径" }));
	await waitFor(() => expect(copy).toHaveBeenCalledWith("/workspace/report.md"));
	view.unmount();
	render(
		<ActivityPanelContextProvider
			value={{
				workspace: { id: "/workspace", cwd: "/workspace", runtimeIds: ["runtime"] },
				knowledgeHistory: false,
			}}
		>
			<ConversationDeliveries />
		</ActivityPanelContextProvider>,
	);
	expect(screen.getByRole("button", { name: /^Report/ })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "网页 · 1" }));
	expect(screen.queryByRole("button", { name: /^Report/ })).toBeNull();
	expect(screen.getByRole("button", { name: /^Website/ })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "图片 · 0" }));
	expect(screen.getByText("这一类还没有文件或链接。")).toBeTruthy();
});

it("clears the visible resources when the active runtime no longer belongs to this panel", () => {
	render(
		<ActivityPanelContextProvider
			value={{
				workspace: { id: "/workspace", cwd: "/workspace", runtimeIds: ["runtime"] },
				knowledgeHistory: false,
			}}
		>
			<ConversationDeliveries />
		</ActivityPanelContextProvider>,
	);
	act(() => store.set(activeSessionAtom, { runtimeId: "other", cwd: "/other", sessionPath: "/other.jsonl" }));
	expect(screen.queryByRole("button", { name: /^Report/ })).toBeNull();
	expect(screen.getByText(/本会话还没有/)).toBeTruthy();
});

it("lets a new conversation paint before indexing and never publishes the cancelled conversation's resources", async () => {
	const old = store.get(chatMessagesAtom)[0];
	act(() =>
		store.set(
			chatMessagesAtom,
			Array.from({ length: 60 }, (_, index) => ({
				...old,
				id: `old-${index}`,
				entryId: `old-${index}`,
				blocks: [{ type: "text" as const, id: `text-${index}`, text: `[Old ${index}](./old-${index}.txt)` }],
			})),
		),
	);
	const view = render(
		<ActivityPanelContextProvider
			value={{
				workspace: { id: "/workspace", cwd: "/workspace", runtimeIds: ["runtime"] },
				knowledgeHistory: false,
			}}
		>
			<ConversationDeliveries />
		</ActivityPanelContextProvider>,
	);
	expect(screen.getByText("正在从会话历史整理文件与链接…")).toBeTruthy();
	act(() => {
		store.set(activeSessionAtom, { runtimeId: "new", cwd: "/workspace", sessionPath: "/new.jsonl" });
		store.set(chatMessagesAtom, [
			{
				kind: "agent",
				role: "assistant",
				id: "new-reply",
				turnId: "new-turn",
				authorId: "agent",
				phase: "completed",
				blocks: [{ type: "text", id: "new-text", text: "[New report](./new.txt)" }],
			},
		]);
	});
	view.rerender(
		<ActivityPanelContextProvider
			value={{ workspace: { id: "/workspace", cwd: "/workspace", runtimeIds: ["new"] }, knowledgeHistory: false }}
		>
			<ConversationDeliveries />
		</ActivityPanelContextProvider>,
	);
	expect(await screen.findByRole("button", { name: /^New report/ })).toBeTruthy();
	expect(screen.queryByRole("button", { name: /^Old / })).toBeNull();
	expect(screen.getByRole("button", { name: "全部 · 1" })).toBeTruthy();
});
