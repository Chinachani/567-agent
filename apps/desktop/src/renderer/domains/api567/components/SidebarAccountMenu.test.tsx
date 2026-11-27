// @vitest-environment jsdom
import type { Api567BilledSnapshot } from "@/shared/local-usage-log";
import type { ImBridgeStatus } from "@preload/api-types/im";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { getDefaultStore } from "jotai";
import { notificationUnreadAtom, confirmDialogAtom } from "@shared/store/atoms";
import { afterEach, beforeEach, beforeAll, expect, it, vi } from "vitest";

const navigate = vi.hoisted(() => vi.fn());
const getBilledUsage = vi.fn<() => Promise<Api567BilledSnapshot>>();
const idleBridge: ImBridgeStatus = { transport: "online", activeSessions: 0, consecutiveStartFailures: 0 };
let publishImStatus: ((status: ImBridgeStatus) => void) | undefined;
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
import { MessageCenter } from "@domains/project/components/sidebar/message-center/MessageCenter";
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
	state.status.loginUsername = "夜雨寄北";
	getBilledUsage.mockReset().mockResolvedValue({ status: "unavailable" });
	publishImStatus = undefined;
	getDefaultStore().set(notificationUnreadAtom, 0);
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			api567: { getBilledUsage },
			im: {
				subscribeStatus: async (listener: (status: ImBridgeStatus) => void) => {
					publishImStatus = listener;
					return () => { publishImStatus = undefined; };
				},
				getStatus: async () => idleBridge,
				onSessionChanged: () => () => {},
			},
			config: { get: async () => ({ projects: [] }), onProjectsChanged: () => () => {} },
			session: { listSessions: async () => [], onSessionsChanged: () => () => {} },
			notification: {
				listResults: async () => ({ tasks: [], unavailableCount: 0, truncated: false }),
				markResultRead: async () => {},
			},
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

it("reads today's spend on open and refreshes it without closing the account menu", async () => {
	const user = userEvent.setup();
	getBilledUsage
		.mockResolvedValueOnce({ status: "ready", usd: 1.23, quota: 615000, checkedAt: Date.now() })
		.mockResolvedValueOnce({ status: "ready", usd: 2.34, quota: 1170000, checkedAt: Date.now() });
	render(<SidebarAccountMenu />);
	expect(getBilledUsage).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "打开 Nickname 的账号菜单" }));
	expect(screen.getByRole("region", { name: "账户概览" }).textContent).toContain("今日消费");
	await screen.findByText(/1\.23/);
	await user.click(screen.getByRole("menuitem", { name: "更新费用" }));
	await screen.findByText(/2\.34/);
	expect(screen.getByRole("menu")).toBeTruthy();
});

it("ignores a late spend response after switching accounts in the open menu", async () => {
	const user = userEvent.setup();
	let resolveOld!: (snapshot: Api567BilledSnapshot) => void;
	getBilledUsage
		.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
		.mockResolvedValueOnce({ status: "ready", usd: 2.34, quota: 1170000 });
	const view = render(<SidebarAccountMenu />);
	await user.click(screen.getByRole("button", { name: "打开 Nickname 的账号菜单" }));
	await waitFor(() => expect(getBilledUsage).toHaveBeenCalled());
	state.status.loginUsername = "另一个账户";
	view.rerender(<SidebarAccountMenu />);
	await screen.findByText(/2\.34/);
	await act(async () => resolveOld({ status: "ready", usd: 123.45, quota: 61725000 }));
	expect(screen.queryByText(/123\.45/)).toBeNull();
	expect(screen.getByText(/2\.34/)).toBeTruthy();
});

it("shows Claw as connected when at least one channel is online", async () => {
	const user = userEvent.setup();
	render(<SidebarAccountMenu />);
	await user.click(screen.getByRole("button", { name: "打开 Nickname 的账号菜单" }));
	expect(await screen.findByRole("menuitem", { name: "Claw 已连接" })).toBeTruthy();
	act(() => publishImStatus?.({ ...idleBridge, channelStatuses: { telegram: "error", wechat: "connecting" } }));
	expect(screen.getByRole("menuitem", { name: "Claw 未连接" })).toBeTruthy();
	act(() => publishImStatus?.({ ...idleBridge, channelStatuses: { telegram: "error", wechat: "online" } }));
	expect(screen.getByRole("menuitem", { name: "Claw 已连接" })).toBeTruthy();
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

it("hands focus between the menu and settings, account and recharge, retaining guest access", async () => {
	const user = userEvent.setup();
	const view = render(<SidebarAccountMenu />);
	const trigger = screen.getByRole("button", { name: "打开 Nickname 的账号菜单" });
	await user.click(trigger);
	await user.click(await screen.findByRole("menuitem", { name: "设置" }));
	await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/settings/$tab", params: { tab: "general" } }));
	expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
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
});

it("supports keyboard access, routes Claw and exposes sign-in without removing local actions", async () => {
	const user = userEvent.setup();
	const view = render(<SidebarAccountMenu />);
	const trigger = screen.getByRole("button", { name: "打开 Nickname 的账号菜单" });
	trigger.focus();
	await user.keyboard("{Enter}");
	await screen.findByRole("menuitem", { name: "设置" });
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

it("announces unread notifications on the header bell and restores its focus after closing", async () => {
	const user = userEvent.setup();
	getDefaultStore().set(notificationUnreadAtom, 3);
	render(<MessageCenter />);
	const trigger = screen.getByRole("button", { name: "消息中心" });
	expect(document.getElementById(trigger.getAttribute("aria-describedby") ?? "")?.textContent).toBe("3 条未读通知");
	trigger.focus();
	await user.keyboard("{Enter}");
	await screen.findByRole("dialog", { name: "消息中心" });
	await user.keyboard("{Escape}");
	await waitFor(() => expect(document.activeElement).toBe(trigger));
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
