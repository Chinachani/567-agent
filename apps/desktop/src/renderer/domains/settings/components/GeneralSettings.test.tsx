/** @vitest-environment jsdom */

import { initI18n } from "@shared/i18n";
import { SETUP_WIZARD_OPEN_EVENT } from "@shared/setup-wizard/storage";
import { updaterStateAtom } from "@shared/store/atoms";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { createStore, Provider } from "jotai";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { GeneralSettings } from "./GeneralSettings";

beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});
beforeEach(() => {
	Object.assign(window, {
		agent567: {
			updater: {
				getPreferences: async () => ({
					automaticCheck: true,
					checkIntervalMinutes: 120,
					automaticDownload: true,
					showReminder: true,
				}),
				setPreferences: vi.fn(async (value) => value),
				getReleaseHistory: async () => ({ baselineVersion: "1.5.0", releases: [] }),
			},
			shell: { openExternal: vi.fn() },
			config: { get: async () => ({ notificationsEnabled: true }), set: vi.fn() },
			appMonitor: { recordEvent: vi.fn() },
		},
	});
});
afterEach(cleanup);

it("groups usage help and initial setup with distinct purposes and retains backup", async () => {
	const user = userEvent.setup();
	const onSetup = vi.fn();
	window.addEventListener(SETUP_WIZARD_OPEN_EVENT, onSetup);
	try {
		render(
			<Provider store={createStore()}>
				<GeneralSettings />
			</Provider>,
		);
		const help = screen.getByRole("region", { name: "帮助与入门" });
		expect(within(help).getByText(/语言、外观/)).toBeTruthy();
		const guideButton = within(help).getByRole("button", { name: "打开使用指南" });
		await user.click(guideButton);
		const dialog = screen.getByRole("dialog", { name: "使用指南" });
		await user.click(within(dialog).getByRole("button", { name: "手机协作与远程控制" }));
		expect(within(dialog).getByText(/在电脑确认屏幕共享/)).toBeTruthy();
		expect(onSetup).not.toHaveBeenCalled();
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(guideButton);
		await user.click(within(help).getByRole("button", { name: "重新设置" }));
		expect(onSetup).toHaveBeenCalledOnce();
		expect(screen.getByRole("region", { name: "数据与备份" })).toBeTruthy();
		expect(screen.getByLabelText("备份密码（8–128 个字符）")).toBeTruthy();
	} finally {
		window.removeEventListener(SETUP_WIZARD_OPEN_EVENT, onSetup);
	}
});

it("composes the version row, one download progress and saved update controls in the real settings page", async () => {
	const store = createStore();
	store.set(updaterStateAtom, {
		phase: "downloading",
		currentVersion: "1.5.0",
		latestVersion: "1.5.1",
		progress: 0.44,
		downloadedBytes: 30_300_000,
		totalBytes: 68_500_000,
	});
	render(
		<Provider store={store}>
			<GeneralSettings />
		</Provider>,
	);
	expect(screen.getByText("版本")).toBeTruthy();
	expect(screen.getByText("1.5.0")).toBeTruthy();
	expect(screen.getByText("正在下载 1.5.1 · 44% · 30.3 / 68.5 MB")).toBeTruthy();
	expect(screen.getAllByRole("progressbar")).toHaveLength(1);
	await screen.findByRole("switch", { name: "自动下载更新" });
	expect(screen.getByRole("button", { name: "查看说明" })).toBeTruthy();
});
