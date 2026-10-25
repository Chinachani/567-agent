// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { getDefaultStore } from "jotai";
import { notificationUnreadAtom, confirmDialogAtom } from "@shared/store/atoms";
import { afterEach, beforeEach, beforeAll, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
	groupsLoadState: { loading: false, error: false, loaded: true, request: 0 },
	availableGroups: {} as Record<string, { ratio: number; desc: string }>,
	loadAvailableGroups: vi.fn(),
	syncGroup: vi.fn(),
	setActiveGroup: vi.fn(),
	logout: vi.fn(),
	refreshQuota: vi.fn(),
	setTopupModalOpen: vi.fn(),
	setModalOpen: vi.fn(),
	status: {
		isLoggedIn: true,
		username: "Nickname",
		loginUsername: "夜雨寄北",
		quotaUsd: 21.41,
		activeGroup: "反重力Gemini",
		groups: [{ name: "other", modelsCount: 1 }],
	},
}));
vi.mock("../hooks/useApi567", () => ({ useApi567: () => state }));
vi.mock("./ServiceRouteSettings", () => ({ ServiceRouteSettings: () => null }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
import { SidebarAccountMenu } from "@domains/project/components/sidebar/SidebarAccountMenu";
async function openDetails(user: ReturnType<typeof userEvent.setup>) {
	await user.click(screen.getByRole("button", { name: "打开 Nickname 的账号菜单" }));
	await user.click(await screen.findByRole("menuitem", { name: "账号与模型分组" }));
	await screen.findByRole("dialog", { name: "567 API 账户" });
}
afterEach(cleanup);
beforeEach(() => {
	state.availableGroups = {};
	state.groupsLoadState = { loading: false, error: false, loaded: true, request: 0 };
	vi.clearAllMocks();
	state.status.isLoggedIn = true;
	getDefaultStore().set(notificationUnreadAtom, 0);
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			im: { subscribeStatus: async () => () => {}, getStatus: async () => ({ transport: "online" }) },
			updater: { sync: vi.fn(async () => {}) },
			subscription: { getStatus: async () => ({}) },
			appMonitor: { recordEvent: () => {} },
		},
	});
});
beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});

it("shows the account username initial while retaining the display name", () => {
	render(<SidebarAccountMenu />);
	expect(screen.getByRole("button", { name: "打开 Nickname 的账号菜单" }).textContent).toContain("夜");
	expect(screen.queryByText("N")).toBeNull();
});

it("opens account details from the complete summary without changing the shown balance", async () => {
	const user = userEvent.setup();
	render(
		<div style={{ width: 180 }}>
			<SidebarAccountMenu />
		</div>,
	);
	const trigger = screen.getByRole("button", { name: "打开 Nickname 的账号菜单" });
	expect(trigger.textContent).toContain("$21.41");
	expect(trigger.textContent).toContain("余额");
	expect(trigger.textContent).not.toContain("反重力Gemini");
	await openDetails(user);
	expect(screen.getByText("当前可用额度")).toBeTruthy();
	expect(screen.getByText("$21.41")).toBeTruthy();
	expect(trigger.textContent).toContain("$21.41");
});

it("distinguishes loading, failure and empty groups and offers retry", async () => {
	const user = userEvent.setup();
	state.groupsLoadState.loading = true;
	const view = render(<SidebarAccountMenu />);
	await openDetails(user);
	expect(screen.getByRole("status").textContent).toContain("正在读取");
	expect(screen.queryByRole("button", { name: i18n.t("settings:api567Feedback.retry") })).toBeNull();
	state.groupsLoadState = { ...state.groupsLoadState, loading: false, error: true };
	view.rerender(<SidebarAccountMenu />);
	await user.click(screen.getByRole("button", { name: i18n.t("settings:api567Feedback.retry") }));
	expect(state.loadAvailableGroups).toHaveBeenCalledWith(true);
	state.groupsLoadState.error = false;
	view.rerender(<SidebarAccountMenu />);
	expect(screen.getByRole("status").textContent).toContain("暂无");
});
it("locks group changes until completion and confirms sign out before calling it", async () => {
	const user = userEvent.setup();
	let resolve!: () => void;
	state.setActiveGroup.mockImplementation(
		() =>
			new Promise<void>((done) => {
				resolve = done;
			}),
	);
	state.availableGroups = { other: { ratio: 1, desc: "" }, unconnected: { ratio: 1, desc: "" } };
	render(<SidebarAccountMenu />);
	await openDetails(user);
	await user.click(screen.getByRole("button", { name: "设为主力" }));
	expect(screen.getByRole<HTMLButtonElement>("button", { name: "设置中…" }).disabled).toBe(true);
	expect(screen.getByRole<HTMLButtonElement>("button", { name: "接入" }).disabled).toBe(true);
	expect(state.setActiveGroup).toHaveBeenCalledOnce();
	await act(async () => resolve());
	await user.keyboard("{Escape}");
	await user.click(screen.getByRole("button", { name: "打开 Nickname 的账号菜单" }));
	await user.click(await screen.findByRole("menuitem", { name: "退出 567 登录" }));
	expect(state.logout).not.toHaveBeenCalled();
	const confirmation = getDefaultStore().get(confirmDialogAtom);
	expect(confirmation?.variant).toBe("danger");
	act(() => confirmation?.onConfirm(false));
	await waitFor(() => expect(state.logout).toHaveBeenCalledOnce());
});

it("hands focus between the menu and settings, notifications, account and recharge, retaining guest access", async () => {
	const user = userEvent.setup();
	const view = render(<SidebarAccountMenu />);
	const trigger = screen.getByRole("button", { name: "打开 Nickname 的账号菜单" });
	await user.click(trigger);
	await user.click(await screen.findByRole("menuitem", { name: "设置" }));
	await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/settings/$tab", params: { tab: "general" } }));
	expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
	await waitFor(() => expect(document.activeElement).toBe(trigger));
	await user.click(trigger);
	await user.click(await screen.findByRole("menuitem", { name: "消息中心" }));
	await screen.findByRole("dialog", { name: "消息中心" });
	await user.keyboard("{Escape}");
	await waitFor(() => expect(document.activeElement).toBe(trigger));
	await openDetails(user);
	await user.click(screen.getByRole("button", { name: "账户额度充值" }));
	await waitFor(() => expect(state.setTopupModalOpen).toHaveBeenCalledWith(true));
	expect(document.activeElement).toBe(trigger);
	state.status.isLoggedIn = false;
	view.rerender(<SidebarAccountMenu />);
	await user.click(screen.getByRole("button", { name: "打开 本机账户 的账号菜单" }));
	expect(screen.queryByRole("menuitem", { name: "退出 567 登录" })).toBeNull();
	expect(screen.getByRole("menuitem", { name: "设置" })).toBeTruthy();
	expect(screen.getByRole("menuitem", { name: "消息中心" })).toBeTruthy();
});

it("supports keyboard access and unread notification context, routes Claw and exposes sign-in without removing local actions", async () => {
	const user = userEvent.setup();
	getDefaultStore().set(notificationUnreadAtom, 3);
	const view = render(<SidebarAccountMenu />);
	const trigger = screen.getByRole("button", { name: "打开 Nickname 的账号菜单" });
	expect(trigger.getAttribute("aria-describedby")).toBeTruthy();
	expect(screen.getByText("3 条未读通知")).toBeTruthy();
	trigger.focus();
	await user.keyboard("{Enter}");
	await screen.findByRole("menuitem", { name: /消息中心/ });
	await user.keyboard("{Escape}");
	await waitFor(() => expect(document.activeElement).toBe(trigger));
	await user.click(trigger);
	await user.click(await screen.findByRole("menuitem", { name: /Claw/ }));
	await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/settings/$tab", params: { tab: "im" } }));
	state.status.isLoggedIn = false;
	view.rerender(<SidebarAccountMenu />);
	await user.click(screen.getByRole("button", { name: "打开 本机账户 的账号菜单" }));
	await user.click(screen.getByRole("menuitem", { name: "登录 567 API" }));
	await waitFor(() => expect(state.setModalOpen).toHaveBeenCalledWith(true));
});

it("switches theme in place while keeping the account menu open", async () => {
	const user = userEvent.setup();
	window.matchMedia = vi.fn().mockReturnValue({ matches: false });
	render(<SidebarAccountMenu />);
	await user.click(screen.getByRole("button", { name: "打开 Nickname 的账号菜单" }));
	await user.click(screen.getByRole("menuitemradio", { name: "亮色" }));
	await waitFor(() => expect(document.documentElement.getAttribute("data-mode")).toBe("light"));
	expect(screen.getByRole("menu")).toBeDefined();
	screen.getByRole("menuitemradio", { name: "暗色" }).focus();
	await user.keyboard("{Enter}");
	await waitFor(() => expect(document.documentElement.getAttribute("data-mode")).toBe("dark"));
	await user.click(screen.getByRole("menuitemradio", { name: "暗色" }));
	await waitFor(() => expect(document.documentElement.getAttribute("data-mode")).toBe("dark"));
});
