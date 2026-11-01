import { Provider, createStore, useStore } from "jotai";
import { activeComposerCommandsAtom } from "@shared/store/atoms";
import { useGlobalShortcuts } from "@shared/hooks/useShortcuts";
import { getShortcutScopeStack, __setShortcutScopeStackForTests } from "@shared/shortcuts";
import { InputBar } from "../InputBar";
// @vitest-environment jsdom

import { initI18n } from "@shared/i18n";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InputBarView } from "./InputBarView";
import type { InputBarModel } from "./types";

const respondToPlanReview = vi.fn(async () => {});
const respondToQuestion = vi.fn(async () => {});
const respondToMcpElicitation = vi.fn(async () => {});

beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("en");
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			models: { get: async () => ({ providers: {} }), fetchRemote: async () => ({ providers: {} }) },
			session: { respondToPlanReview, respondToQuestion, respondToMcpElicitation },
		},
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function draftModel(): InputBarModel {
	return {
		dropZone: {
			dragKind: null,
			enabled: true,
			labels: { releaseToRef: "Drop", internalRef: "Reference", externalRef: "File" },
			onDragEnter: vi.fn(),
			onDragOver: vi.fn(),
			onDragLeave: vi.fn(),
			onDrop: vi.fn(),
		},
		isStreaming: true,
		pendingQuestion: undefined,
		pendingMcpElicitation: undefined,
		imageAttachments: [],
		activeActions: [],
		appshotAttachment: null,
		hasSession: true,
		canSend: true,
		isEmpty: false,
		showPlaceholder: false,
		hasCapsules: false,
		effectiveCwd: "",
		placeholderTexts: ["Message"],
		placeholderRotating: false,
		isFocused: false,
		drawerItems: [],
		drawerActiveTab: null,
		todo: null,
		speechInput: null,
		hasPromptAttachment: false,
		pendingMessageEdit: false,
		pendingEditHint: "",
		cancelPendingEditLabel: "Cancel",
		contextMenu: null,
		editor: { namespace: "flow-test", value: "My unsent draft", onValueChange: vi.fn() },
		modelSelector: { updateActiveSession: false },
		leadingTools: [],
		trailingTools: [],
		sendBehavior: "queueable",
		labels: {
			capsule: {
				removeDefault: "Remove",
				removeImage: "Remove",
				removeTooltip: (path) => path,
				activeGroup: String,
			},
			permission: { deny: "Deny", allow: "Allow", allowSession: "Allow session" },
			toolbar: { skills: "Skills", addImage: "Image", attachFile: "File", queue: "Queue" },
		},
		actions: {
			setFocused: vi.fn(),
			setDrawerActiveTab: vi.fn(),
			handleEnter: () => false,
			handleContextMenu: vi.fn(),
			removeImage: vi.fn(),
			openImagePreview: vi.fn(),
			removePromptAttachment: vi.fn(),
			removeAppshot: vi.fn(),
			handleSelectImages: async () => {},
			handleSelectFiles: async () => {},
			handleSend: vi.fn(),
			handleAbort: async () => {},
			cancelPendingEdit: vi.fn(),
		},
	};
}

it.each(["plan", "question", "mcp"] as const)(
	"lets the %s panel own the input area while preserving the mounted editor and draft",
	async (kind) => {
		const base = draftModel();
		const view = render(<InputBarView model={base} />);
		const editor = screen.getByRole("textbox", { name: "Message" });
		await waitFor(() => expect(editor.textContent).toContain("My unsent draft"));
		const pending: Partial<InputBarModel> =
			kind === "plan"
				? {
						pendingPlanReview: {
							requestId: "plan",
							sessionId: "session",
							plan: "1. Read the sources\n2. Apply the fix",
						},
					}
				: kind === "question"
					? {
							pendingQuestion: {
								requestId: "question",
								sessionId: "session",
								questions: [
									{
										question: "Choose a layout",
										header: "Layout",
										options: [{ label: "Compact", description: "Keep room for messages" }],
										multiSelect: false,
									},
								],
							},
						}
					: {
							pendingMcpElicitation: {
								requestId: "mcp",
								sessionId: "session",
								serverName: "Demo",
								mode: "form",
								message: "Confirm configuration",
								fields: [],
							},
						};
		view.rerender(<InputBarView model={{ ...base, ...pending }} />);
		expect(screen.queryByRole("textbox", { name: "Message" })).toBeNull();
		expect(editor.isConnected).toBe(true);
		expect(editor.closest("[inert]")?.getAttribute("style")).toContain("display: none");
		const action = kind === "plan" ? /approve/i : kind === "question" ? /cancel/i : /submit/i;
		fireEvent.click(screen.getByRole("button", { name: action }));
		const response =
			kind === "plan" ? respondToPlanReview : kind === "question" ? respondToQuestion : respondToMcpElicitation;
		await waitFor(() => expect(response).toHaveBeenCalledOnce());
		view.rerender(<InputBarView model={base} />);
		expect(screen.getByRole("textbox", { name: "Message" })).toBe(editor);
		expect(editor.textContent).toContain("My unsent draft");
	},
);

it("places setup model controls beside the lower tools and suppresses only the empty context indicator", () => {
	const base = draftModel();
	const model: InputBarModel = {
		...base,
		contextToolsPlacement: "bottom",
		trailingTools: [
			{
				kind: "context-usage",
				model: {
					percent: 0,
					offset: 0,
					color: "currentColor",
					isCompacting: false,
					tooltip: "Context",
					details: null,
				},
				render: () => <button type="button">Context details</button>,
			},
		],
	};
	const view = render(
		<InputBarView model={model}>
			<div>Setup controls</div>
		</InputBarView>,
	);
	expect(screen.queryByRole("button", { name: "Context details" })).toBeNull();
	const toolbar = view.container.querySelector('[data-message-input-part="context-toolbar"]');
	expect(toolbar?.closest('[data-message-input-part="toolbar"]')).toBeTruthy();
	expect(screen.getByRole("textbox", { name: "Message" })).toBeTruthy();
	view.rerender(
		<InputBarView
			model={{
				...model,
				trailingTools: [
					{
						...model.trailingTools[0],
						kind: "context-usage",
						model: {
							percent: 12,
							offset: 0,
							color: "currentColor",
							isCompacting: false,
							tooltip: "Context",
							details: null,
						},
						render: () => <button type="button">Context details</button>,
					},
				],
			}}
		/>,
	);
	expect(screen.getByRole("button", { name: "Context details" })).toBeTruthy();
});

it("focuses the mounted composer with configured keys and aborts only a busy turn, respecting modal scopes", async () => {
	const onAbort = vi.fn(async () => {});
	let changed: ((event: { bindings: { "focus-input"?: string } }) => void) | undefined;
	Object.assign(window.agent567, {
		config: {
			get: async () => ({}),
			onShortcutsChanged: (listener: typeof changed) => {
				changed = listener;
				return () => {};
			},
		},
	});
	const store = createStore();
	function Commands() {
		const store = useStore();
		useGlobalShortcuts(
			(action) => {
				const commands = store.get(activeComposerCommandsAtom);
				if (action === "focus-input") commands?.focus();
				if (action === "stop-generation") commands?.abort();
			},
			(action) => action !== "stop-generation" || Boolean(store.get(activeComposerCommandsAtom)?.isBusy()),
		);
		return null;
	}
	const base = draftModel();
	const model = { ...base, isStreaming: false, actions: { ...base.actions, handleAbort: onAbort } };
	const view = render(
		<Provider store={store}>
			<Commands />
			<InputBar model={model} />
		</Provider>,
	);
	await waitFor(() => expect(changed).toBeDefined());
	const editor = screen.getByRole("textbox", { name: "Message" });
	fireEvent.keyDown(document, { key: "l", ctrlKey: true });
	await waitFor(() => expect(document.activeElement).toBe(editor));
	const idle = new KeyboardEvent("keydown", { key: "Backspace", ctrlKey: true, cancelable: true });
	document.dispatchEvent(idle);
	expect(idle.defaultPrevented).toBe(false);
	expect(onAbort).not.toHaveBeenCalled();
	view.rerender(
		<Provider store={store}>
			<Commands />
			<InputBar model={{ ...model, isStreaming: true }} />
		</Provider>,
	);
	fireEvent.keyDown(document, { key: "Backspace", ctrlKey: true });
	expect(onAbort).toHaveBeenCalledOnce();
	const modal = getShortcutScopeStack().register({
		id: "confirmation",
		kind: "modal",
		exclusive: true,
		getBindings: () => [],
	});
	fireEvent.keyDown(document, { key: "Backspace", ctrlKey: true });
	expect(onAbort).toHaveBeenCalledOnce();
	modal.dispose();
	act(() => changed?.({ bindings: { "focus-input": "mod+shift+l" } }));
	editor.blur();
	document.getSelection()?.removeAllRanges();
	const oldKey = new KeyboardEvent("keydown", { key: "l", ctrlKey: true, cancelable: true });
	document.dispatchEvent(oldKey);
	expect(oldKey.defaultPrevented).toBe(false);
	const customKey = new KeyboardEvent("keydown", { key: "l", ctrlKey: true, shiftKey: true, cancelable: true });
	document.dispatchEvent(customKey);
	expect(customKey.defaultPrevented).toBe(true);
	view.unmount();
	expect(store.get(activeComposerCommandsAtom)).toBeNull();
	__setShortcutScopeStackForTests(null);
});
