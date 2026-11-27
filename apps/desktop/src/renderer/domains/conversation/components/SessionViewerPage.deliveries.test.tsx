// @vitest-environment jsdom

import { createAssistantMessage } from "@567agent/ai";
import type { HistoryEntry } from "@567agent/runtime-core";
import type * as Router from "@tanstack/react-router";
import { initI18n } from "@shared/i18n";
import { activeSessionAtom, activityPanelOpenAtom, chatMessagesAtom, defaultImConversationCwdAtom, filePreviewAtom, knowledgeProcessingCwdAtom } from "@shared/store/atoms";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { createStore, Provider } from "jotai";
import { type Ref, useImperativeHandle } from "react";
import type * as VirtuosoModule from "react-virtuoso";
import { afterEach, expect, it, vi } from "vitest";
import { SessionViewerPage } from "./SessionViewerPage";

const route = vi.hoisted(() => ({ path: "", navigate: vi.fn() }));
const scrollToIndex = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof Router>()),
	useNavigate: () => route.navigate,
	useParams: () => ({ path: encodeURIComponent(route.path) }),
	useSearch: () => ({}),
}));

vi.mock("react-virtuoso", async (importOriginal) => ({
	...(await importOriginal<typeof VirtuosoModule>()),
	Virtuoso: ({ ref }: { ref: Ref<{ scrollToIndex: typeof scrollToIndex }> }) => {
		useImperativeHandle(ref, () => ({ scrollToIndex }));
		return <div />;
	},
}));

function transcript(entryId: string, text: string): { history: HistoryEntry[] } {
	return {
		history: [
			{
				type: "message",
				entryId,
				message: {
					...createAssistantMessage({ api: "openai-completions", provider: "openai", model: "test" }, { timestamp: 1 }),
					content: [{ type: "text", text }],
				},
			},
		],
	};
}

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	scrollToIndex.mockClear();
});

it("shows only the selected Claw transcript's deliveries and jumps to its source across same-directory switches", async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	const cwd = "/claw";
	const firstPath = `${cwd}/first.jsonl`;
	const secondPath = `${cwd}/second.jsonl`;
	const first = transcript("first-source", "[First file](./first.md)");
	const second = transcript("second-source", "[Second link](https://second.test/)");
	let resolveSecond!: (snapshot: typeof second) => void;
	const pendingSecond = new Promise<typeof second>((resolve) => { resolveSecond = resolve; });
	const subscriptions = new Map<string, (snapshot: typeof first) => void>();
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
	vi.stubGlobal("ResizeObserver", class {
		observe() {}
		disconnect() {}
	});
	vi.stubGlobal("agent567", {
		fs: {
			readDir: async () => [],
			watchDir: vi.fn(),
			unwatchDir: vi.fn(),
			onDirChanged: () => vi.fn(),
		},
		models: { get: async () => ({}), fetchRemote: async () => ({}) },
		session: {
			openViewer: (path: string) => (path === firstPath ? Promise.resolve(first) : pendingSecond),
			subscribeViewer: async (path: string, onUpdate: (snapshot: typeof first) => void) => {
				subscriptions.set(path, onUpdate);
				return vi.fn();
			},
		},
	});
	const store = createStore();
	store.set(defaultImConversationCwdAtom, cwd);
	store.set(knowledgeProcessingCwdAtom, "/knowledge");
	store.set(activityPanelOpenAtom, true);
	store.set(activeSessionAtom, { cwd, runtimeId: "desktop", sessionPath: `${cwd}/desktop.jsonl` });
	store.set(chatMessagesAtom, [
		{
			kind: "agent",
			role: "assistant",
			id: "desktop-reply",
			turnId: "desktop-turn",
			authorId: "agent",
			phase: "completed",
			blocks: [{ type: "text", id: "text", text: "[Desktop file](./desktop.md)" }],
		},
	]);
	const page = (
		<Provider store={store}>
			<SessionViewerPage />
		</Provider>
	);
	route.path = firstPath;
	const mounted = render(page);
	const user = userEvent.setup();
	await user.click(await screen.findByRole("tab", { name: "交付" }));
	await user.click(await screen.findByRole("button", { name: /^First file/ }));
	expect(store.get(filePreviewAtom)).toMatchObject({ path: `${cwd}/first.md` });
	expect(screen.queryByRole("button", { name: /^Desktop file/ })).toBeNull();
	const oldSubscription = subscriptions.get(firstPath);
	expect(oldSubscription).toBeDefined();

	route.path = secondPath;
	mounted.rerender(<Provider store={store}><SessionViewerPage /></Provider>);
	expect(screen.queryByRole("button", { name: /^First file/ })).toBeNull();
	await act(async () => {
		oldSubscription?.(transcript("old-source", "[Late file](./late.md)"));
	});
	expect(screen.queryByRole("button", { name: /^Late file/ })).toBeNull();
	await act(async () => {
		resolveSecond(second);
	});
	expect(await screen.findByRole("button", { name: /^Second link/ })).toBeTruthy();
	expect(screen.queryByRole("button", { name: /^Late file/ })).toBeNull();
	expect(screen.getByRole("button", { name: "全部 · 1" })).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "查看来源" }));
	await waitFor(() => expect(scrollToIndex).toHaveBeenCalledWith({ index: 0, align: "center", behavior: "smooth" }));
});
