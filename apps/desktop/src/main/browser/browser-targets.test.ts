import { EventEmitter } from "node:events";
import type path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BROWSER_EXTENSION_URL } from "../../shared/current-browser-connection";
import {
	browserExecutableCandidates,
	getBrowserTargets,
	identifyBrowserApplication,
	prepareBrowserTarget,
} from "./browser-targets";

const host = vi.hoisted(() => ({
	name: vi.fn(() => "Microsoft Edge"),
	info: vi.fn(async () => ({ path: "/Applications/Microsoft Edge.app" })),
	access: vi.fn(async (_file: string) => {}),
	spawn: vi.fn(),
	prepare: vi.fn(async () => "/isolated/browser-extensions/playwright/0.4.0"),
}));
vi.mock("./bundled-extension.js", () => ({ prepareBundledExtension: host.prepare }));
vi.mock("electron", () => ({
	app: { getApplicationNameForProtocol: host.name, getApplicationInfoForProtocol: host.info },
}));
vi.mock("node:fs/promises", () => ({ constants: { F_OK: 0, X_OK: 1 }, access: host.access }));
vi.mock("node:child_process", () => ({ spawn: host.spawn }));
// Simulating process.platform must not depend on the runner's native path separator.
vi.mock("node:path", async (importOriginal) => {
	const actual = await importOriginal<{ default: typeof path }>();
	return { ...actual, default: { ...actual.default, join: actual.default.win32.join } };
});
const platform = process.platform;
beforeEach(() => {
	host.prepare.mockReset().mockResolvedValue("/isolated/browser-extensions/playwright/0.4.0");
	Object.defineProperty(process, "platform", { value: "linux" });
	host.name.mockReset().mockReturnValue("microsoft-edge.desktop");
	host.info.mockReset().mockResolvedValue({ path: "/Applications/Microsoft Edge.app" });
	host.access.mockReset().mockImplementation(async (file) => {
		if (file !== "/opt/microsoft/msedge/msedge") throw new Error("ENOENT");
	});
	host.spawn.mockReset().mockImplementation(() => {
		const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
		queueMicrotask(() => child.emit("spawn"));
		return child;
	});
});
afterEach(() => Object.defineProperty(process, "platform", { value: platform }));

describe("browser setup OS boundary", () => {
	it.each([
		["Google Chrome", "chrome"],
		["google-chrome-stable.desktop", "chrome"],
		["Microsoft Edge", "msedge"],
		["microsoft-edge.desktop", "msedge"],
		["chromium-browser.desktop", "chromium"],
		["Chromium", "chromium"],
		["Firefox", null],
		["Safari", null],
		["chrome-malicious.desktop", null],
		["Google Chrome Beta", null],
		["", null],
	])("classifies %s conservatively", (name, expected) => expect(identifyBrowserApplication(name)).toBe(expected));
	it("detects the default without opening anything, then opens the fixed store in that same executable", async () => {
		await expect(getBrowserTargets()).resolves.toEqual({
			defaultBrowser: "msedge",
			defaultApplication: "microsoft-edge.desktop",
			available: ["msedge"],
		});
		expect(host.spawn).not.toHaveBeenCalled();
		const target = await prepareBrowserTarget("msedge", "store");
		expect(target).toEqual({ id: "msedge" });
		expect(host.spawn).toHaveBeenCalledWith(
			"/opt/microsoft/msedge/msedge",
			[BROWSER_EXTENSION_URL],
			expect.objectContaining({ shell: false, stdio: "ignore" }),
		);
		await prepareBrowserTarget("msedge", "resolve");
		expect(host.spawn).toHaveBeenCalledOnce();
	});
	it("allows manual selection with an unknown default and never substitutes another browser when missing", async () => {
		host.name.mockReturnValue("Firefox");
		expect((await getBrowserTargets()).defaultBrowser).toBeNull();
		await expect(prepareBrowserTarget("chrome", "store")).rejects.toThrow("browser_target_unavailable");
		expect(host.spawn).not.toHaveBeenCalled();
		await expect(prepareBrowserTarget("msedge", "resolve")).resolves.toMatchObject({ id: "msedge" });
	});
	it("propagates native launch failure so the caller cannot report a successful install preparation", async () => {
		host.spawn.mockImplementation(() => {
			const child = new EventEmitter();
			queueMicrotask(() => child.emit("error", new Error("launch denied")));
			return child;
		});
		await expect(prepareBrowserTarget("msedge", "store")).rejects.toThrow("launch denied");
	});
	it("resolves system Chromium itself rather than Playwright's downloaded Chromium", async () => {
		host.name.mockReturnValue("chromium.desktop");
		host.access.mockImplementation(async (file) => {
			if (file !== "/snap/bin/chromium") throw new Error("ENOENT");
		});
		await expect(prepareBrowserTarget("chromium", "resolve")).resolves.toEqual({
			id: "chromium",
			executablePath: "/snap/bin/chromium",
		});
	});
	it.each([
		{
			platform: "darwin",
			applicationPath: "/custom/Microsoft Edge.app",
			executablePath: "/custom/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		},
		{
			platform: "win32",
			applicationPath: "D:\\Custom Browser\\msedge.exe",
			executablePath: "D:\\Custom Browser\\msedge.exe",
		},
	])("resolves and opens a nonstandard default browser on $platform", async (scenario) => {
		Object.defineProperty(process, "platform", { value: scenario.platform });
		host.info.mockResolvedValue({ path: scenario.applicationPath });
		host.access.mockImplementation(async (file) => {
			if (file !== scenario.executablePath) throw new Error("ENOENT");
		});
		await expect(getBrowserTargets()).resolves.toMatchObject({ defaultBrowser: "msedge", available: ["msedge"] });
		await expect(prepareBrowserTarget("msedge", "resolve")).resolves.toEqual({
			id: "msedge",
			executablePath: scenario.executablePath,
		});
		expect(host.spawn).not.toHaveBeenCalled();
		await prepareBrowserTarget("msedge", "store");
		expect(host.spawn).toHaveBeenCalledWith(
			scenario.executablePath,
			[BROWSER_EXTENSION_URL],
			expect.objectContaining({ shell: false }),
		);
	});
	it("has explicit macOS and Windows locations, with no shell command or profile inspection", () => {
		expect(
			browserExecutableCandidates("msedge", "win32", "C:\\Users\\test", { PROGRAMFILES: "C:\\Program Files" }),
		).toEqual(["C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"]);
		expect(browserExecutableCandidates("chrome", "darwin", "/Users/test", {})).toContain(
			"/Users/test/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		);
	});
	it("prepares the built-in package before opening Edge extensions, without command-line installation flags", async () => {
		const result = await prepareBrowserTarget("msedge", "bundled");
		expect(result).toEqual({ id: "msedge", extensionDirectory: "/isolated/browser-extensions/playwright/0.4.0" });
		expect(host.spawn).toHaveBeenCalledWith(
			"/opt/microsoft/msedge/msedge",
			["edge://extensions/"],
			expect.objectContaining({ shell: false }),
		);
	});
	it("does not open a browser when bundle verification fails, and can retry after recovery", async () => {
		host.prepare.mockRejectedValueOnce(new Error("invalid signature"));
		await expect(prepareBrowserTarget("msedge", "bundled")).rejects.toThrow("browser_extension_prepare_failed");
		expect(host.spawn).not.toHaveBeenCalled();
		await expect(prepareBrowserTarget("msedge", "bundled")).resolves.toMatchObject({ id: "msedge" });
	});
});
