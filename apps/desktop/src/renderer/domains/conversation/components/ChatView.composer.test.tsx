// @vitest-environment jsdom

import { initI18n } from "@shared/i18n";
import { openSessionFnRef, pendingSessionOpenAtom } from "@shared/store/atoms";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { getDefaultStore } from "jotai";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const connectorRender = vi.hoisted(() => vi.fn());

vi.mock("./input-bar/DefaultInputBarConnector", () => ({
	DefaultInputBarConnector: () => {
		connectorRender();
		return <textarea aria-label="Message" />;
	},
}));

import { DefaultChatComposer } from "./ChatView";

describe("DefaultChatComposer", () => {
	beforeAll(async () => {
		initI18n();
		await i18n.changeLanguage("zh");
	});

	afterEach(() => {
		connectorRender.mockClear();
		getDefaultStore().set(pendingSessionOpenAtom, null);
		openSessionFnRef.current = null;
	});

	it("does not redraw when the surrounding message view rerenders with stable actions", () => {
		const props = {
			onAbort: vi.fn(async () => undefined),
			onSend: vi.fn(async () => undefined),
			onSendQueued: vi.fn(async () => undefined),
			cwdOverride: "C:/workspace",
		};
		const { rerender } = render(<DefaultChatComposer {...props} />);
		expect(connectorRender).toHaveBeenCalledTimes(1);

		rerender(<DefaultChatComposer {...props} />);
		expect(connectorRender).toHaveBeenCalledTimes(1);

		rerender(<DefaultChatComposer {...props} cwdOverride="C:/other" />);
		expect(connectorRender).toHaveBeenCalledTimes(2);
	});

	it("shows restore progress and retry by the input without remounting the draft", async () => {
		const user = userEvent.setup();
		const store = getDefaultStore();
		const pending = { cwd: "/repo", sessionPath: "/sessions/previous.jsonl", interactionId: "restore" };
		const reopen = vi.fn(async () => store.set(pendingSessionOpenAtom, pending));
		openSessionFnRef.current = reopen;
		store.set(pendingSessionOpenAtom, pending);
		render(<DefaultChatComposer onSend={vi.fn()} onAbort={vi.fn()} onSendQueued={vi.fn()} />);

		const editor = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Message" });
		const status = screen.getByRole("status");
		expect(status.textContent).toContain("正在打开会话…");
		expect(status.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		await user.type(editor, "Continue from here");

		act(() => store.set(pendingSessionOpenAtom, { ...pending, error: "Could not load history" }));
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.getByRole("alert").textContent).toContain("会话打开失败");
		await user.click(screen.getByRole("button", { name: "重新打开" }));
		expect(reopen).toHaveBeenCalledWith(pending.cwd, pending.sessionPath);
		expect(screen.getByRole("status").textContent).toContain("正在打开会话…");

		act(() => store.set(pendingSessionOpenAtom, null));
		expect(screen.queryByRole("status")).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(screen.getByRole("textbox", { name: "Message" })).toBe(editor);
		expect(editor.value).toBe("Continue from here");
	});
});
