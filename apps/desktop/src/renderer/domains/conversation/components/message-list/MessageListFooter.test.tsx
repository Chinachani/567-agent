// @vitest-environment jsdom
import { Provider, createStore } from "jotai";
import { act, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type * as ThemeChat from "@vetta-org/theme-ui/chat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, unknown>) => {
			if (key === "messageList.retryIndicator") return `正在重新连接（${values?.attempt}/${values?.maxAttempts}）`;
			if (key === "messageList.retryReason") return `上次请求失败：${values?.reason}`;
			if (key === "messageList.errorBlock.kinds.server.title") return "服务暂时出了点问题";
			return key;
		},
	}),
}));

vi.mock("@vetta-org/theme-ui/chat", async (importOriginal) => ({
	...(await importOriginal<typeof ThemeChat>()),
	MessageListFooter: {
		Root: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		Presence: ({ children }: { children: ReactNode }) => <>{children}</>,
		Pending: ({ label }: { label: string }) => <span>{label}</span>,
		Compacting: ({ label }: { label: string }) => <span>{label}</span>,
		Retry: ({ detail, label }: { detail?: string; label: string }) => (
			<div>
				<span>{label}</span>
				{detail ? <span>{detail}</span> : null}
			</div>
		),
		Waiting: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	},
}));
vi.mock("../../../plugins/components/PluginTurnCardHost", () => ({ PluginTurnCardHost: () => null }));
vi.mock("./AssistantMessage", () => ({ StreamingIndicator: () => null }));
vi.mock("./WorkflowFooterItems", () => ({ WorkflowFooterItems: () => null }));

import { retryProgressAtom } from "@shared/store/atoms";
import { setChatStreamOwner } from "../../services/chat-service";
import { useSessionEventController } from "../../hooks/useSessionEventController";
import { MessageListFooter } from "./MessageListFooter";

describe("MessageListFooter retry progress", () => {
	const store = createStore();

	beforeEach(() => store.set(retryProgressAtom, null));
	afterEach(() => setChatStreamOwner(null));

	it("shows the reconnect attempt and a user-friendly reason", () => {
		store.set(retryProgressAtom, {
			attempt: 1,
			maxAttempts: 3,
			errorMessage: "503 service unavailable",
		});

		render(
			<Provider store={store}>
				<MessageListFooter isCompacting={false} waiting />
			</Provider>,
		);

		expect(screen.getByText("正在重新连接（1/3）")).toBeTruthy();
		expect(screen.getByText("上次请求失败：服务暂时出了点问题")).toBeTruthy();
	});

	it("重试开始后首段思考恢复时移除重连卡，后续重试仍可重新显示", () => {
		setChatStreamOwner("session-1");
		const activeSessionRef = {
			current: { runtimeId: "session-1", cwd: "/workspace", sessionPath: "/sessions/session-1.jsonl" },
		};
		const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
		const { result } = renderHook(() => useSessionEventController({ activeSessionRef }), { wrapper });
		render(<MessageListFooter isCompacting={false} waiting />, { wrapper });
		const onEvent = result.current.createSessionEventHandler("session-1");
		const base = {
			schemaVersion: 1 as const,
			channel: "runtime" as const,
			sessionId: "session-1",
			timestamp: 1,
			source: "runtime-core" as const,
		};
		act(() => {
			onEvent({ ...base, type: "retry.start", eventId: "retry-1", attempt: 1, maxAttempts: 3, delayMs: 1, errorMessage: "503 service unavailable" });
		});
		expect(screen.getByText("正在重新连接（1/3）")).toBeTruthy();
		act(() => {
			onEvent({ ...base, type: "session.lifecycle", eventId: "agent-start", phase: "agent_start" });
		});
		expect(screen.getByText("正在重新连接（1/3）")).toBeTruthy();
		act(() => {
			onEvent({ ...base, type: "thinking.delta", eventId: "thinking", delta: "继续分析" });
		});
		expect(screen.queryByText("正在重新连接（1/3）")).toBeNull();
		act(() => {
			onEvent({ ...base, type: "retry.start", eventId: "retry-2", attempt: 2, maxAttempts: 3, delayMs: 1, errorMessage: "503 service unavailable" });
		});
		expect(screen.getByText("正在重新连接（2/3）")).toBeTruthy();
		act(() => {
			onEvent({ ...base, type: "retry.end", eventId: "retry-end", attempt: 2, success: true });
		});
		expect(screen.queryByText("正在重新连接（2/3）")).toBeNull();
	});
	it("shows session startup status in the message list footer", () => {
		render(
			<Provider store={store}>
				<MessageListFooter isCompacting={false} pendingLabel="正在启动会话" waiting={false} />
			</Provider>,
		);

		expect(screen.getByText("正在启动会话")).toBeTruthy();
	});
});
