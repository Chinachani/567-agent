// @vitest-environment jsdom

import type { RuntimeSandboxGrantInfo } from "@567agent/runtime-core";
import { initI18n } from "@shared/i18n";
import { activeSessionAtom } from "@shared/store/atoms";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SandboxGrantsBadge } from "./SandboxGrantsBadge";

const session = { runtimeId: "first", cwd: "/workspace", sessionPath: "/first.jsonl" };
const grant = {
	id: "grant-first",
	sessionId: "first",
	capability: "file.write",
	toolName: "write",
	grantRoot: "/workspace/output",
	firstTarget: "/workspace/output/report.txt",
	createdAt: 1,
} satisfies RuntimeSandboxGrantInfo;
const list = vi.fn(async (_id: string): Promise<RuntimeSandboxGrantInfo[]> => [grant]);
const revoke = vi.fn(async (_sessionId: string, _grantId: string) => {});
const revokeAll = vi.fn(async (_sessionId: string) => {});

beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	list.mockReset().mockResolvedValue([grant]);
	revoke.mockReset().mockResolvedValue(undefined);
	revokeAll.mockReset().mockResolvedValue(undefined);
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: { session: { listSandboxGrants: list, revokeSandboxGrant: revoke, revokeAllSandboxGrants: revokeAll } },
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function mount() {
	const store = createStore();
	store.set(activeSessionAtom, session);
	const view = render(
		<Provider store={store}>
			<SandboxGrantsBadge />
		</Provider>,
	);
	return { store, ...view };
}

it("opens grants outside the header layer, restores focus on Escape and revokes the selected grant", async () => {
	const user = userEvent.setup();
	const view = mount();
	const trigger = await screen.findByRole("button", { name: "本会话沙箱授权" });
	await user.click(trigger);
	const dialog = screen.getByRole("dialog", { name: "本会话沙箱授权" });
	expect(view.container.contains(dialog)).toBe(false);
	expect(within(dialog).getByText("/workspace/output")).toBeTruthy();
	await user.keyboard("{Escape}");
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(document.activeElement).toBe(trigger);
	await user.click(trigger);
	list.mockResolvedValue([]);
	await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "撤销" }));
	await waitFor(() => expect(screen.queryByRole("button", { name: "本会话沙箱授权" })).toBeNull());
	expect(revoke).toHaveBeenCalledWith("first", "grant-first");
});

it("keeps grants visible after a failed revoke and permits retrying all grants", async () => {
	const user = userEvent.setup();
	mount();
	await user.click(await screen.findByRole("button", { name: "本会话沙箱授权" }));
	revoke.mockRejectedValueOnce(new Error("private transport details"));
	await user.click(screen.getByRole("button", { name: "撤销" }));
	expect((await screen.findByRole("alert")).textContent).toContain("撤销授权失败");
	expect(screen.getByRole("dialog").textContent).not.toContain("private transport");
	expect(screen.getByText("/workspace/output")).toBeTruthy();
	list.mockResolvedValue([]);
	await user.click(screen.getByRole("button", { name: "全部撤销" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(revokeAll).toHaveBeenCalledWith("first");
});

it("discards grants from a departed session and closes the old panel before showing the new session", async () => {
	const user = userEvent.setup();
	let finishOld: (value: RuntimeSandboxGrantInfo[]) => void = () => {};
	list.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishOld = resolve;
			}),
	);
	const { store } = mount();
	list.mockResolvedValue([{ ...grant, id: "second-grant", grantRoot: "/second/private" }]);
	act(() => store.set(activeSessionAtom, { ...session, runtimeId: "second" }));
	const trigger = await screen.findByRole("button", { name: "本会话沙箱授权" });
	await user.click(trigger);
	expect(await screen.findByText("/second/private")).toBeTruthy();
	await act(async () => finishOld([grant]));
	expect(screen.queryByText("/workspace/output")).toBeNull();
	act(() => store.set(activeSessionAtom, { ...session, runtimeId: "third" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(revoke).not.toHaveBeenCalled();
});

it("does not restore a revoked grant when an older list query finishes late", async () => {
	const user = userEvent.setup();
	mount();
	const trigger = await screen.findByRole("button", { name: "本会话沙箱授权" });
	let finishList: (value: RuntimeSandboxGrantInfo[]) => void = () => {};
	list.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				finishList = resolve;
			}),
	);
	await user.click(trigger);
	list.mockResolvedValue([]);
	await user.click(screen.getByRole("button", { name: "撤销" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	await act(async () => finishList([grant]));
	expect(screen.queryByRole("button", { name: "本会话沙箱授权" })).toBeNull();
});

it("blocks repeated revocation and discards its late error after switching sessions", async () => {
	const user = userEvent.setup();
	const { store } = mount();
	await user.click(await screen.findByRole("button", { name: "本会话沙箱授权" }));
	let failRevoke: (reason: Error) => void = () => {};
	revoke.mockImplementationOnce(
		() =>
			new Promise((_resolve, reject) => {
				failRevoke = reject;
			}),
	);
	await user.dblClick(screen.getByRole("button", { name: "撤销" }));
	expect(revoke).toHaveBeenCalledTimes(1);
	expect(screen.getByRole("button", { name: "全部撤销" }).hasAttribute("disabled")).toBe(true);
	list.mockResolvedValue([{ ...grant, id: "next", sessionId: "second", grantRoot: "/second/output" }]);
	act(() => store.set(activeSessionAtom, { ...session, runtimeId: "second" }));
	await user.click(await screen.findByRole("button", { name: "本会话沙箱授权" }));
	await act(async () => failRevoke(new Error("old failure")));
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.getByText("/second/output")).toBeTruthy();
	expect(screen.getByRole("button", { name: "全部撤销" }).hasAttribute("disabled")).toBe(false);
});

it("reports a failed post-revoke refresh and recovers when reopened", async () => {
	const user = userEvent.setup();
	mount();
	await user.click(await screen.findByRole("button", { name: "本会话沙箱授权" }));
	list.mockRejectedValueOnce(new Error("cannot refresh"));
	await user.click(screen.getByRole("button", { name: "撤销" }));
	expect((await screen.findByRole("alert")).textContent).toContain("授权已撤销，但列表暂未刷新");
	await user.keyboard("{Escape}");
	list.mockResolvedValue([]);
	await user.click(screen.getByRole("button", { name: "本会话沙箱授权" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
