/** @vitest-environment jsdom */
import type { McpConfigData } from "@preload/api";
import { initI18n } from "@shared/i18n";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BROWSER_EXTENSION_URL,
	CURRENT_BROWSER_SERVER_NAME,
	PLAYWRIGHT_MCP_VERSION,
} from "../mcp/current-browser-connection";
import { BrowserConnectionSettings } from "./BrowserConnectionSettings";

const paint = vi.hoisted(() => ({ run: vi.fn<() => Promise<unknown>>() }));
vi.mock("@shared/lib/committed-paint", () => ({ waitForCommittedPaint: paint.run }));
beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});
let config: McpConfigData;
let get: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;
let openExternal: ReturnType<typeof vi.fn>;
let prepareBrowser: ReturnType<typeof vi.fn>;
let getBrowserTargets: ReturnType<typeof vi.fn>;
beforeEach(() => {
	paint.run.mockReset().mockResolvedValue("painted");
	config = { mcpServers: { personal: { command: "custom-connector", env: { USER_CONFIG: "keep" } } } };
	get = vi.fn(async () => structuredClone(config));
	set = vi.fn(async (next: McpConfigData) => {
		config = structuredClone(next);
	});
	openExternal = vi.fn(async () => undefined);
	prepareBrowser = vi.fn(async (id: string, action: string) => ({
		id,
		...(id === "chromium" ? { executablePath: "/usr/bin/chromium" } : {}),
		...(action === "bundled" ? { extensionDirectory: "/isolated/browser-extensions/playwright/0.4.0" } : {}),
	}));
	getBrowserTargets = vi.fn(async () => ({
		defaultBrowser: "chrome",
		defaultApplication: "Google Chrome",
		available: ["chrome", "msedge", "chromium"],
	}));
	Object.assign(window, {
		agent567: {
			mcp: { get, set },
			auth: { openExternal },
			settings: { getBrowserTargets, prepareBrowserTarget: prepareBrowser },
		},
	});
});
afterEach(cleanup);

async function openSettings(): Promise<ReturnType<typeof userEvent.setup>> {
	const user = userEvent.setup();
	render(<BrowserConnectionSettings />);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "打开安装页并启用连接" }).hasAttribute("disabled")).toBe(false),
	);
	return user;
}

describe("current browser extension setup", () => {
	it("renders first, then reads settings; enabling and reopening preserves unrelated connections and pairing", async () => {
		let releasePaint!: () => void;
		paint.run.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					releasePaint = resolve;
				}),
		);
		const user = userEvent.setup();
		const page = render(<BrowserConnectionSettings />);
		expect(screen.getByRole("heading", { name: "连接当前浏览器" })).toBeTruthy();
		expect(get).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
		await act(async () => releasePaint());
		await waitFor(() =>
			expect(screen.getByRole("button", { name: "打开安装页并启用连接" }).hasAttribute("disabled")).toBe(false),
		);
		const guideButton = screen.getByRole("button", { name: "安装与连接指南" });
		await user.click(guideButton);
		const guide = screen.getByRole("dialog", { name: "安装与连接指南" });
		expect(within(guide).getAllByRole("listitem")).toHaveLength(3);
		expect(document.activeElement).toBe(within(guide).getByRole("heading", { name: "安装与连接指南" }));
		await user.click(within(guide).getByRole("button", { name: "打开官方安装页" }));
		await user.keyboard("{Escape}");
		expect(document.activeElement).toBe(guideButton);
		expect(prepareBrowser).toHaveBeenCalledWith("chrome", "store");
		await user.click(screen.getByText("可选：免重复授权与多浏览器配置"));
		await user.type(screen.getByLabelText("免重复授权令牌（可选）"), "test-pairing-token");
		await user.type(screen.getByLabelText("浏览器用户配置目录名（可选）"), "Profile 2");
		// A different settings surface changed another connection since the initial read.
		config.mcpServers.later = { command: "later-connector" };
		await user.click(screen.getByRole("button", { name: "打开安装页并启用连接" }));
		await screen.findByRole("status");
		expect(config.mcpServers.personal).toEqual({ command: "custom-connector", env: { USER_CONFIG: "keep" } });
		expect(config.mcpServers.later).toEqual({ command: "later-connector" });
		expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
			command: "npx",
			args: ["-y", `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, "--extension"],
			disabled: false,
			env: {
				PLAYWRIGHT_MCP_EXTENSION_TOKEN: "test-pairing-token",
				PLAYWRIGHT_MCP_PROFILE_DIR_NAME: "Profile 2",
				PLAYWRIGHT_MCP_BROWSER: "chrome",
			},
		});
		expect(screen.getByRole("status").textContent).toContain("请在浏览器中完成添加扩展");
		page.unmount();
		await openSettingsForExisting();
		expect((screen.getByLabelText("免重复授权令牌（可选）") as HTMLInputElement).value).toBe("test-pairing-token");
		await user.click(screen.getByRole("button", { name: "停用连接" }));
		await waitFor(() => expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME].disabled).toBe(true));
		expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
			env: { PLAYWRIGHT_MCP_EXTENSION_TOKEN: "test-pairing-token" },
		});
		await user.click(screen.getByRole("button", { name: "打开安装页并启用连接" }));
		await waitFor(() => expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME].disabled).toBe(false));
	});

	it("never overwrites a same-name custom connection, including one added during editing", async () => {
		const user = await openSettings();
		config.mcpServers[CURRENT_BROWSER_SERVER_NAME] = { command: "user-owned-program" };
		await user.click(screen.getByRole("button", { name: "打开安装页并启用连接" }));
		expect((await screen.findByRole("alert")).textContent).toContain("自定义配置");
		expect(set).not.toHaveBeenCalled();
		expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toEqual({ command: "user-owned-program" });
	});

	it("keeps entered pairing values after a failed save and permits retry without duplicate writes", async () => {
		const user = await openSettings();
		await user.click(screen.getByText("可选：免重复授权与多浏览器配置"));
		await user.type(screen.getByLabelText("免重复授权令牌（可选）"), "test-secret");
		set.mockRejectedValueOnce(new Error("external error containing test-secret"));
		await user.click(screen.getByRole("button", { name: "打开安装页并启用连接" }));
		expect((await screen.findByRole("alert")).textContent).toBe("未能保存连接设置，你填写的内容已保留。");
		expect(screen.getByRole("alert").textContent).not.toContain("test-secret");
		expect((screen.getByLabelText("免重复授权令牌（可选）") as HTMLInputElement).value).toBe("test-secret");
		let finishSave!: () => void;
		set.mockImplementationOnce(async (next: McpConfigData) => {
			await new Promise<void>((resolve) => {
				finishSave = resolve;
			});
			config = next;
		});
		await user.dblClick(screen.getByRole("button", { name: "打开安装页并启用连接" }));
		await waitFor(() => expect(set).toHaveBeenCalledTimes(2));
		await act(async () => finishSave());
		await screen.findByRole("status");
		expect(set).toHaveBeenCalledTimes(2);
	});

	it("shows read failures and recovers after an explicit reload without writing configuration", async () => {
		get.mockRejectedValueOnce(new Error("read failed"));
		const user = userEvent.setup();
		render(<BrowserConnectionSettings />);
		expect((await screen.findByRole("alert")).textContent).toContain("未能读取");
		await user.click(screen.getByRole("button", { name: "重新读取" }));
		await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
		expect(get).toHaveBeenCalledTimes(2);
		expect(set).not.toHaveBeenCalled();
	});
});

async function openSettingsForExisting(): Promise<void> {
	render(<BrowserConnectionSettings />);
	await waitFor(() => expect(screen.getByRole("button", { name: "停用连接" }).hasAttribute("disabled")).toBe(false));
}

it("explains Chrome and Edge installation, configures through the guide, and reopens with live state and the same draft", async () => {
	const user = await openSettings();
	await user.click(screen.getByText("可选：免重复授权与多浏览器配置"));
	await user.type(screen.getByLabelText("浏览器用户配置目录名（可选）"), "Profile 4");
	const trigger = screen.getByRole("button", { name: "安装与连接指南" });
	await user.click(trigger);
	let guide = screen.getByRole("dialog", { name: "安装与连接指南" });
	expect(within(guide).getByText(/点击“添加至 Chrome”/)).toBeTruthy();
	expect(within(guide).getByText(/若浏览器提示允许其他商店/)).toBeTruthy();
	expect(within(guide).queryByText(/扩展已安装$/)).toBeNull();
	await user.click(within(guide).getByRole("button", { name: "启用连接" }));
	await waitFor(() => expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({ disabled: false }));
	expect(openExternal).not.toHaveBeenCalled();
	expect(within(guide).getByText("本机连接配置已启用 · 尚未验证浏览器连接")).toBeTruthy();
	await user.keyboard("{Escape}");
	expect((screen.getByLabelText("浏览器用户配置目录名（可选）") as HTMLInputElement).value).toBe("Profile 4");
	await user.click(trigger);
	guide = screen.getByRole("dialog", { name: "安装与连接指南" });
	expect(within(guide).getByText("本机连接配置已启用 · 尚未验证浏览器连接")).toBeTruthy();
	expect(within(guide).queryByRole("button", { name: "启用连接" })).toBeNull();
});

it("does not enable a connection when the install page fails to open and allows a retry", async () => {
	const user = await openSettings();
	prepareBrowser.mockRejectedValueOnce(new Error("OS could not open browser"));
	await user.click(screen.getByRole("button", { name: "打开安装页并启用连接" }));
	expect((await screen.findByRole("alert")).textContent).toContain("未能找到或打开所选浏览器");
	expect(set).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "打开安装页并启用连接" }));
	await waitFor(() => expect(set).toHaveBeenCalledOnce());
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.getByRole("status").textContent).toContain("请在浏览器中完成添加扩展");
});

it("copies the official store link with a timed acknowledgement and no false success on failure", async () => {
	const user = await openSettings();
	const writeText = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
	await user.click(screen.getByRole("button", { name: "安装与连接指南" }));
	const guide = screen.getByRole("dialog", { name: "安装与连接指南" });
	await user.click(within(guide).getByRole("button", { name: "复制商店链接" }));
	expect((await within(guide).findByRole("alert")).textContent).toContain("未能复制商店链接");
	expect(within(guide).queryByRole("button", { name: "已复制链接" })).toBeNull();
	writeText.mockResolvedValueOnce();
	await user.click(within(guide).getByRole("button", { name: "复制商店链接" }));
	expect(writeText).toHaveBeenLastCalledWith(BROWSER_EXTENSION_URL);
	await within(guide).findByRole("button", { name: "已复制链接" });
	expect(within(guide).queryByRole("alert")).toBeNull();
	await within(guide).findByRole("button", { name: "复制商店链接" }, { timeout: 2500 });
	expect(set).not.toHaveBeenCalled();
});

it("auto-selects Chrome, switches installation and connection together, and preserves the saved target on reopen", async () => {
	const user = await openSettings();
	expect(screen.getByRole("button", { name: "目标浏览器" }).textContent).toContain("Google Chrome");
	expect(screen.getByText(/系统默认：Google Chrome/)).toBeTruthy();
	expect(prepareBrowser).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "目标浏览器" }));
	await user.click(screen.getByRole("button", { name: "Chromium" }));
	await user.click(screen.getByRole("button", { name: "打开安装页并启用连接" }));
	await screen.findByRole("status");
	expect(prepareBrowser).toHaveBeenCalledWith("chromium", "store");
	expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
		env: {
			PLAYWRIGHT_MCP_BROWSER: "chrome",
			PLAYWRIGHT_MCP_EXECUTABLE_PATH: "/usr/bin/chromium",
			AGENT567_BROWSER_TARGET: "chromium",
		},
	});
	cleanup();
	await openSettingsForExisting();
	expect(screen.getByRole("button", { name: "目标浏览器" }).textContent).toContain("Chromium");
	await user.click(screen.getByRole("button", { name: "目标浏览器" }));
	await user.click(screen.getByRole("button", { name: "Microsoft Edge" }));
	await user.click(screen.getByRole("button", { name: "保存浏览器" }));
	await waitFor(() =>
		expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
			env: { PLAYWRIGHT_MCP_BROWSER: "msedge" },
		}),
	);
	expect(prepareBrowser).toHaveBeenLastCalledWith("msedge", "resolve");
});
it("requires a supported manual choice for Firefox and does not silently connect to Chrome", async () => {
	getBrowserTargets.mockResolvedValue({ defaultBrowser: null, defaultApplication: "Firefox", available: ["msedge"] });
	const user = userEvent.setup();
	render(<BrowserConnectionSettings />);
	await screen.findByText(/系统默认是 Firefox/);
	expect(screen.getByRole("button", { name: "打开安装页并启用连接" }).hasAttribute("disabled")).toBe(true);
	expect(set).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "目标浏览器" }));
	await user.click(screen.getByRole("button", { name: "Microsoft Edge" }));
	await user.click(screen.getByRole("button", { name: "准备内置扩展并启用连接" }));
	await within(screen.getByRole("dialog")).findByRole("status");
	expect(prepareBrowser).toHaveBeenCalledWith("msedge", "bundled");
});
it("keeps custom destinations intact while saving pairing settings", async () => {
	const args = [
		"-y",
		`@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`,
		"--extension",
		"--executable-path=/my/browser",
		"--browser=chrome-beta",
	];
	config.mcpServers[CURRENT_BROWSER_SERVER_NAME] = { command: "npx", args, disabled: false };
	const user = userEvent.setup();
	await openSettingsForExisting();
	expect(screen.getByRole("button", { name: "目标浏览器" }).textContent).toContain("保留自定义目标");
	await user.click(screen.getByText("可选：免重复授权与多浏览器配置"));
	await user.type(screen.getByLabelText("免重复授权令牌（可选）"), "pair-token");
	await user.click(screen.getByRole("button", { name: "保存高级设置" }));
	await screen.findByRole("status");
	expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({ args });
	expect(prepareBrowser).not.toHaveBeenCalled();
});

it("saves a pending target change from inside the guide before declaring the configuration ready", async () => {
	const user = await openSettings();
	await user.click(screen.getByRole("button", { name: "打开安装页并启用连接" }));
	await screen.findByRole("status");
	await user.click(screen.getByRole("button", { name: "目标浏览器" }));
	await user.click(screen.getByRole("button", { name: "Chromium" }));
	await user.click(screen.getByRole("button", { name: "安装与连接指南" }));
	const guide = screen.getByRole("dialog", { name: "安装与连接指南" });
	expect(within(guide).getByText("目标浏览器（尚未保存）：Chromium")).toBeTruthy();
	expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({ env: { PLAYWRIGHT_MCP_BROWSER: "chrome" } });
	await user.click(within(guide).getByRole("button", { name: "保存浏览器" }));
	await waitFor(() =>
		expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
			env: { PLAYWRIGHT_MCP_BROWSER: "chrome" },
		}),
	);
	expect(within(guide).getByText("本机连接配置已启用 · 尚未验证浏览器连接")).toBeTruthy();
	expect(within(guide).getByText("当前目标：Chromium")).toBeTruthy();
	expect(prepareBrowser).toHaveBeenLastCalledWith("chromium", "resolve");
});

it("prepares the bundled extension for default Edge, shows the remaining browser steps, and copies the real directory", async () => {
	getBrowserTargets.mockResolvedValue({
		defaultBrowser: "msedge",
		defaultApplication: "Microsoft Edge",
		available: ["msedge"],
	});
	const user = userEvent.setup();
	render(<BrowserConnectionSettings />);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "准备内置扩展并启用连接" }).hasAttribute("disabled")).toBe(false),
	);
	expect(prepareBrowser).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "准备内置扩展并启用连接" }));
	const guide = screen.getByRole("dialog", { name: "安装与连接指南" });
	expect((await within(guide).findByRole("status")).textContent).toContain("尚未验证扩展安装");
	expect(within(guide).getByText(/开启“开发人员模式”/)).toBeTruthy();
	expect(within(guide).getByText(/不会从商店自动更新/)).toBeTruthy();
	expect(prepareBrowser).toHaveBeenCalledWith("msedge", "bundled");
	expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
		disabled: false,
		env: { PLAYWRIGHT_MCP_BROWSER: "msedge" },
	});
	const copy = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
	await user.click(within(guide).getByRole("button", { name: "复制扩展目录" }));
	expect((await within(guide).findByRole("alert")).textContent).toContain("未能复制扩展目录");
	expect(within(guide).queryByRole("button", { name: "已复制目录" })).toBeNull();
	copy.mockResolvedValueOnce();
	await user.click(within(guide).getByRole("button", { name: "复制扩展目录" }));
	await within(guide).findByRole("button", { name: "已复制目录" });
	expect(copy).toHaveBeenLastCalledWith("/isolated/browser-extensions/playwright/0.4.0");
	await within(guide).findByRole("button", { name: "复制扩展目录" }, { timeout: 2500 });
	await user.keyboard("{Escape}");
	await user.click(screen.getByRole("button", { name: "安装与连接指南" }));
	expect(within(screen.getByRole("dialog")).getByText("/isolated/browser-extensions/playwright/0.4.0")).toBeTruthy();
});

it("keeps configuration untouched on bundle failure and offers store installation or a successful retry", async () => {
	getBrowserTargets.mockResolvedValue({
		defaultBrowser: "msedge",
		defaultApplication: "Microsoft Edge",
		available: ["msedge"],
	});
	prepareBrowser.mockRejectedValueOnce(new Error("browser_extension_prepare_failed"));
	const user = userEvent.setup();
	render(<BrowserConnectionSettings />);
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "准备内置扩展并启用连接" }).hasAttribute("disabled")).toBe(false),
	);
	await user.click(screen.getByRole("button", { name: "准备内置扩展并启用连接" }));
	const guide = screen.getByRole("dialog");
	expect((await within(guide).findByRole("alert")).textContent).toContain("未能准备内置扩展");
	expect(set).not.toHaveBeenCalled();
	expect(within(guide).queryByRole("button", { name: "复制扩展目录" })).toBeNull();
	await user.click(within(guide).getByRole("button", { name: "打开官方安装页" }));
	await waitFor(() => expect(prepareBrowser).toHaveBeenLastCalledWith("msedge", "store"));
	expect(set).not.toHaveBeenCalled();
	await user.click(within(guide).getByRole("button", { name: "准备目录并打开扩展管理页" }));
	await within(guide).findByRole("status");
	expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
		disabled: false,
		env: { PLAYWRIGHT_MCP_BROWSER: "msedge" },
	});
	expect(within(guide).queryByRole("alert")).toBeNull();
});
