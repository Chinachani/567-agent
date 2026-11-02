// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createConversationAgentMessage, createConversationUserMessage } from "@shared/conversation";
import { RendererMarkdownScope } from "@shared/components/RendererMarkdownScope";
import {
	activeSessionAtom,
	appshotAttachmentAtom,
	chatMessagesAtom,
	confirmDialogAtom,
	inputValueAtom,
	mentionedFilesAtom,
	openSessionFnRef,
	pendingMessageEditAtom,
	pendingSessionCreationAtom,
	pendingSessionOpenAtom,
} from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { initI18n, i18n } from "@shared/i18n";
import type { ReactNode } from "react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { SessionUserMessage } from "./SessionUserMessage";
import { MessageItem } from "./MessageItem";
import { SessionMessageRendering } from "../SessionMessageRendering";
import type { ChatConversationItem } from "./types";
import { MessageRenderingDefaults, MessageRenderingProvider } from "./MessageRendering";

const markdown = {
	theme: "light" as const,
	labels: { copy: "Copy", copied: "Copied" },
	getFileIconClass: () => "",
	onOpenFile: () => undefined,
	onOpenUrl: () => undefined,
};
const store = getDefaultStore();
const session = { cwd: "C:/repo", sessionPath: "C:/a.jsonl", runtimeId: "runtime-a" };
const message = createConversationUserMessage({ id: "user", entryId: "entry-a", text: "Original message" });
const reply = createConversationAgentMessage({
	id: "reply",
	entryId: "assistant-first",
	text: "Complete reply",
	blocks: [{ type: "text", id: "reply-text", text: "Complete reply" }],
});

function SessionTranscript({
	messages = [message, reply],
	isStreaming = false,
	onAbortEdit,
	exportMode = false,
}: {
	messages?: readonly ChatConversationItem[];
	isStreaming?: boolean;
	onAbortEdit?: () => void;
	exportMode?: boolean;
}) {
	return (
		<SessionMessageRendering messages={messages}>
			{messages.map((item, index) => (
				<section key={item.id} aria-label={item.id}>
					<MessageItem
						message={item}
						isStreaming={isStreaming}
						isTailMessage={index === messages.length - 1}
						isLastUserMessage={item.id === "user"}
						onAbortEdit={onAbortEdit}
						exportMode={exportMode}
					/>
				</section>
			))}
		</SessionMessageRendering>
	);
}

const forkSession = vi.fn(async () => ({ path: "C:/fork.jsonl" }));
const deleteMessage = vi.fn(async () => undefined);
const getFullHistory = vi.fn(async () => []);
const openSession = vi.fn(async () => undefined);

function Scope({ children }: { children: ReactNode }) {
	return <RendererMarkdownScope value={markdown}>{children}</RendererMarkdownScope>;
}

beforeEach(() => {
	initI18n();
	void i18n.changeLanguage("zh");
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	Object.defineProperty(window, "vetta", {
		configurable: true,
		value: {
			skills: { list: async () => [] },
			abilities: { listOpenMarketplaces: async () => ({ abilities: [] }) },
			clipboard: { writeUserMessage: async () => undefined },
			session: { forkSession, deleteMessage, getFullHistory },
		},
	});
	forkSession.mockClear();
	deleteMessage.mockClear();
	getFullHistory.mockClear();
	openSession.mockClear();
	store.set(activeSessionAtom, session);
	store.set(pendingSessionCreationAtom, null);
	store.set(pendingSessionOpenAtom, null);
	store.set(inputValueAtom, "");
	store.set(mentionedFilesAtom, []);
	store.set(appshotAttachmentAtom, null);
	store.set(pendingMessageEditAtom, null);
	store.set(confirmDialogAtom, null);
	store.set(chatMessagesAtom, [message]);
	openSessionFnRef.current = openSession;
});
afterEach(() => {
	vi.unstubAllGlobals();
	openSessionFnRef.current = null;
});

describe("message extension workflows", () => {
	it("confirms a streaming fork against the old runtime without aborting or clearing the new composer", async () => {
		let onStopped: ((payload: { sessionId: string; running: boolean }) => void) | undefined;
		const abort = vi.fn(async (runtimeId: string) => onStopped?.({ sessionId: runtimeId, running: false }));
		Object.assign(window.agent567.session, {
			abort,
			onRunningChanged: (listener: typeof onStopped) => {
				onStopped = listener;
				return () => {
					onStopped = undefined;
				};
			},
		});
		const onAbortEdit = vi.fn();
		const view = render(
			<Scope>
				<SessionTranscript
					messages={[
						message,
						reply,
						createConversationUserMessage({ id: "later", entryId: "later-user", text: "Later prompt" }),
					]}
					isStreaming
					onAbortEdit={onAbortEdit}
				/>
			</Scope>,
		);
		fireEvent.click(screen.getByRole("button", { name: "分叉为新会话" }));
		const confirmation = store.get(confirmDialogAtom);
		expect(confirmation).not.toBeNull();
		act(() => {
			store.set(activeSessionAtom, { ...session, runtimeId: "runtime-b", sessionPath: "C:/b.jsonl" });
			store.set(inputValueAtom, "New draft");
			store.set(pendingMessageEditAtom, { entryId: "entry-b" });
		});
		view.unmount();
		await act(async () => {
			await confirmation?.onConfirm(false);
		});
		await waitFor(() => expect(forkSession).toHaveBeenCalledWith("runtime-a", "entry-a"));
		expect(abort).toHaveBeenCalledWith("runtime-a");
		expect(onAbortEdit).not.toHaveBeenCalled();
		expect(openSession).not.toHaveBeenCalled();
		expect(store.get(inputValueAtom)).toBe("New draft");
		expect(store.get(pendingMessageEditAtom)).toEqual({ entryId: "entry-b" });
	});

	it("keeps edit on the user bubble and forks from the assistant footer without changing history", async () => {
		render(
			<Scope>
				<SessionTranscript />
			</Scope>,
		);
		expect(
			within(screen.getByRole("region", { name: "user" })).queryByRole("button", { name: "分叉为新会话" }),
		).toBeNull();
		expect(
			within(screen.getByRole("region", { name: "reply" })).getByRole("button", { name: "分叉为新会话" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		await waitFor(() => expect(store.get(inputValueAtom)).toBe("Original message"));
		expect(store.get(pendingMessageEditAtom)).toEqual({ entryId: "entry-a" });
		expect(store.get(chatMessagesAtom)).toEqual([message]);
		fireEvent.click(screen.getByRole("button", { name: "分叉为新会话" }));
		await waitFor(() => expect(openSession).toHaveBeenCalledWith("C:/repo", "C:/fork.jsonl"));
		expect(forkSession).toHaveBeenCalledWith("runtime-a", "entry-a");
	});

	it("read-only composition exposes content and copy but no session mutations", () => {
		render(
			<Scope>
				<MessageItem message={message} isStreaming={false} isTailMessage />
				<MessageItem message={reply} isStreaming={false} isTailMessage />
			</Scope>,
		);
		expect(screen.getByText("Original message")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
		expect(screen.queryByRole("button", { name: "分叉为新会话" })).toBeNull();
		expect(forkSession).not.toHaveBeenCalled();
	});

	it("forks each completed turn from its final reply, including merged process messages", async () => {
		const laterUser = createConversationUserMessage({ id: "user-b", entryId: "entry-b", text: "Next question" });
		const process = createConversationAgentMessage({
			id: "process",
			entryId: "tool-call-entry",
			text: "Working",
			blocks: [],
		});
		const laterReply = createConversationAgentMessage({
			id: "reply-b",
			entryId: "assistant-b",
			text: "Next reply",
			blocks: [],
		});
		render(
			<Scope>
				<SessionTranscript messages={[message, process, reply, laterUser, laterReply]} />
			</Scope>,
		);
		expect(
			within(screen.getByRole("region", { name: "process" })).queryByRole("button", { name: "分叉为新会话" }),
		).toBeNull();
		fireEvent.click(
			within(screen.getByRole("region", { name: "reply" })).getByRole("button", { name: "分叉为新会话" }),
		);
		await waitFor(() => expect(forkSession).toHaveBeenLastCalledWith("runtime-a", "entry-a"));
		await waitFor(() => expect(openSession).toHaveBeenCalled());
		fireEvent.click(
			within(screen.getByRole("region", { name: "reply-b" })).getByRole("button", { name: "分叉为新会话" }),
		);
		await waitFor(() => expect(forkSession).toHaveBeenLastCalledWith("runtime-a", "entry-b"));
	});

	it("hides fork while a reply is running, then exposes it when complete", () => {
		const view = render(
			<Scope>
				<SessionTranscript isStreaming />
			</Scope>,
		);
		expect(screen.queryByRole("button", { name: "分叉为新会话" })).toBeNull();
		view.rerender(
			<Scope>
				<SessionTranscript />
			</Scope>,
		);
		expect(screen.getByRole("button", { name: "分叉为新会话" })).toBeTruthy();
		view.rerender(
			<Scope>
				<SessionTranscript exportMode />
			</Scope>,
		);
		expect(screen.queryByRole("button", { name: "分叉为新会话" })).toBeNull();
		view.rerender(
			<Scope>
				<SessionTranscript messages={[{ ...message, entryId: undefined }, reply]} />
			</Scope>,
		);
		expect(screen.queryByRole("button", { name: "分叉为新会话" })).toBeNull();
	});

	it("binds confirmed deletion to the original session without replacing the newly opened transcript", async () => {
		const view = render(
			<Scope>
				<SessionUserMessage message={message} isLastUserMessage />
			</Scope>,
		);
		fireEvent.contextMenu(screen.getByText("Original message"));
		fireEvent.click(screen.getByRole("button", { name: "删除" }));
		const confirmation = store.get(confirmDialogAtom);
		expect(confirmation).not.toBeNull();
		const other = createConversationUserMessage({ id: "other", text: "Other session" });
		act(() => {
			store.set(activeSessionAtom, { ...session, runtimeId: "runtime-b", sessionPath: "C:/b.jsonl" });
			store.set(chatMessagesAtom, [other]);
		});
		view.unmount();
		await act(async () => {
			await confirmation?.onConfirm(false);
		});
		await waitFor(() => expect(deleteMessage).toHaveBeenCalledWith("runtime-a", "entry-a"));
		expect(store.get(chatMessagesAtom)).toEqual([other]);
	});

	it("projects and replaces only the locally scoped message without changing its source", () => {
		const definition = {
			project: (item: typeof message) => ({ ...item, text: "Projected message" }),
		};
		render(
			<Scope>
				<MessageRenderingProvider
					value={{ project: (item) => (item.kind === "user" ? definition.project(item) : item) }}
				>
					<MessageItem message={message} isStreaming={false} isTailMessage />
				</MessageRenderingProvider>
				<MessageItem message={message} isStreaming={false} isTailMessage />
			</Scope>,
		);
		expect(screen.getByText("Projected message")).toBeTruthy();
		expect(screen.getByText("Original message")).toBeTruthy();
		expect(message.text).toBe("Original message");
	});
});
it("layers caller overrides over a default recipe without dropping an outer projection", () => {
	const defaults = { renderers: { user: () => <p>Default recipe</p> } };
	const extension = {
		renderers: {
			user: ({ message: item }: { message: typeof message | { kind: string } }) => (
				<p>{item.kind === "user" && "text" in item ? item.text : ""}</p>
			),
		},
	};
	render(
		<MessageRenderingProvider
			value={{ project: (item) => (item.kind === "user" ? { ...item, text: "Projected by caller" } : item) }}
		>
			<MessageRenderingProvider value={extension}>
				<MessageRenderingDefaults value={defaults}>
					<MessageItem message={message} isStreaming={false} isTailMessage />
				</MessageRenderingDefaults>
			</MessageRenderingProvider>
		</MessageRenderingProvider>,
	);
	expect(screen.getByText("Projected by caller")).toBeTruthy();
	expect(screen.queryByText("Default recipe")).toBeNull();
});

it("prepares an older user prompt as a preserved branch without rewriting history on edit", async () => {
	render(
		<Scope>
			<SessionUserMessage message={message} isLastUserMessage={false} />
		</Scope>,
	);
	fireEvent.click(screen.getByRole("button", { name: "编辑" }));
	await waitFor(() => expect(store.get(pendingMessageEditAtom)).toEqual({ entryId: "entry-a", preserveBranch: true }));
	expect(store.get(inputValueAtom)).toContain(message.text);
});
