import { updaterStateAtom } from "@shared/store/atoms";
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createInstance } from "i18next";
import { createStore, Provider } from "jotai";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import settings from "../../../../shared/i18n/locales/zh/settings.json";
import { UpdatePreferencesSettings } from "./UpdatePreferencesSettings";

const defaults = { automaticCheck: true, checkIntervalMinutes: 120, automaticDownload: true, showReminder: true };
const testI18n = createInstance();
let saved = { ...defaults };
let frames: FrameRequestCallback[];
let api: {
	getPreferences: ReturnType<typeof vi.fn>;
	setPreferences: ReturnType<typeof vi.fn>;
	getReleaseHistory: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
	await testI18n.use(initReactI18next).init({
		lng: "zh",
		resources: { zh: { settings } },
		defaultNS: "settings",
		interpolation: { escapeValue: false },
	});
	saved = { ...defaults };
	frames = [];
	api = {
		getPreferences: vi.fn(async () => ({ ...saved })),
		setPreferences: vi.fn(async (value) => {
			saved = value;
			return value;
		}),
		getReleaseHistory: vi.fn(async () => ({
			baselineVersion: "1.4.4",
			releases: [
				{
					version: "1.5.1",
					body: "New fix",
					url: "https://github.com/Chinachani/567-agent/releases/tag/v1.5.1",
					publishedAt: "",
				},
				{
					version: "1.5.0",
					body: "Current changes",
					url: "https://github.com/Chinachani/567-agent/releases/tag/v1.5.0",
					publishedAt: "",
				},
				{
					version: "1.4.4",
					body: "Older changes",
					url: "https://github.com/Chinachani/567-agent/releases/tag/v1.4.4",
					publishedAt: "",
				},
			],
		})),
	};
	vi.stubGlobal("agent567", { updater: api, shell: { openExternal: vi.fn() } });
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
});
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
function mount() {
	const store = createStore();
	store.set(updaterStateAtom, { phase: "idle", currentVersion: "1.5.0" });
	return render(
		<I18nextProvider i18n={testI18n}>
			<Provider store={store}>
				<UpdatePreferencesSettings />
			</Provider>
		</I18nextProvider>,
	);
}
it("saves from the visible switch, survives remounting and preserves the old choice on a failed save", async () => {
	let view = mount();
	const automatic = await screen.findByRole("switch", { name: "自动下载更新" });
	fireEvent.click(automatic);
	await waitFor(() => expect(automatic.getAttribute("aria-checked")).toBe("false"));
	expect(saved.automaticDownload).toBe(false);
	view.unmount();
	view = mount();
	const restored = await screen.findByRole("switch", { name: "自动下载更新" });
	expect(restored.getAttribute("aria-checked")).toBe("false");
	api.setPreferences.mockRejectedValueOnce(new Error("disk full"));
	fireEvent.click(restored);
	await screen.findByRole("alert");
	expect(restored.getAttribute("aria-checked")).toBe("false");
	fireEvent.click(screen.getByRole("button", { name: "重试" }));
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	view.unmount();
});
it("paints notes before fetching and recovers from a failed fetch without downloading or installing", async () => {
	api.getReleaseHistory.mockRejectedValueOnce(new Error("offline"));
	mount();
	await screen.findByRole("switch", { name: "自动检查更新" });
	fireEvent.click(screen.getByRole("button", { name: "查看说明" }));
	expect(screen.getByRole("dialog")).toBeTruthy();
	expect(api.getReleaseHistory).not.toHaveBeenCalled();
	await act(async () => {
		for (let count = 0; count < 2; count++)
			frames.splice(0).forEach((callback) => {
				callback(1);
			});
	});
	await screen.findByRole("button", { name: "重试" });
	fireEvent.click(screen.getByRole("button", { name: "打开发布页" }));
	expect(window.agent567.shell.openExternal).toHaveBeenCalledWith("https://github.com/Chinachani/567-agent/releases");
	fireEvent.click(screen.getByRole("button", { name: "重试" }));
	await act(async () => {
		for (let count = 0; count < 2; count++)
			frames.splice(0).forEach((callback) => {
				callback(2);
			});
	});
	await screen.findByText("Current changes");
	expect(screen.getByText("尚未安装")).toBeTruthy();
	expect(screen.queryByText("Older changes")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "说明范围" }));
	fireEvent.click(await screen.findByRole("button", { name: "最近 10 个版本" }));
	await screen.findByText("Older changes");
	fireEvent.click(screen.getAllByRole("button", { name: "打开发布页" }).at(-1)!);
	expect(window.agent567.shell.openExternal).toHaveBeenCalledWith(
		"https://github.com/Chinachani/567-agent/releases/tag/v1.4.4",
	);
});
it("disables only the interval when automatic checking is disabled", async () => {
	saved.automaticCheck = false;
	mount();
	const automatic = await screen.findByRole("switch", { name: "自动检查更新" });
	expect(screen.getByRole("button", { name: "检查间隔" }).hasAttribute("disabled")).toBe(true);
	fireEvent.click(automatic);
	await waitFor(() => expect(screen.getByRole("button", { name: "检查间隔" }).hasAttribute("disabled")).toBe(false));
});
