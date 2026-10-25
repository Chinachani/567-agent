import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { initializeWindowsDataEnvironment } from "./windows-data-environment.js";
import { parseWindowsRegisteredDataRoot, readWindowsRegisteredDataRoot } from "./windows-data-root.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({ statSync: vi.fn(() => ({ isDirectory: () => true })) }));
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => {
	Object.defineProperty(process, "platform", originalPlatform);
	vi.clearAllMocks();
});
it("loads a Unicode registry path over a fixed UTF8 process boundary", () => {
	Object.defineProperty(process, "platform", { value: "win32" });
	vi.mocked(execFileSync).mockReturnValue(JSON.stringify("D:\\数据 目录"));
	expect(readWindowsRegisteredDataRoot()).toBe("D:\\数据 目录");
	vi.mocked(execFileSync).mockImplementation(() => {
		throw new Error("registry process denied");
	});
	expect(() => readWindowsRegisteredDataRoot()).toThrow(/Unable to read/);
});
it("initializes all paths before application modules bind their file locations", () => {
	const environment: NodeJS.ProcessEnv = {};
	initializeWindowsDataEnvironment(environment, () => "D:\\Existing Data");
	expect(environment.AGENT567_HOME).toBe("D:\\Existing Data");
	expect(environment.AGENT567_DESKTOP_USER_DATA_DIR).toBe("D:\\Existing Data\\electron-user-data");
	expect(environment.AGENT567_WINDOWS_UPDATE_STORE).toBe("D:\\Existing Data\\windows-updates");
	expect(environment.AGENT567_UPDATER_CACHE_DIR).toBe("D:\\Existing Data\\updater-cache");
	vi.mocked(statSync).mockImplementationOnce(() => {
		throw Object.assign(new Error("disconnected drive"), { code: "ENOENT" });
	});
	const offline: NodeJS.ProcessEnv = {};
	expect(() => initializeWindowsDataEnvironment(offline, () => "D:\\Existing Data")).toThrow("disconnected drive");
	expect(offline.AGENT567_HOME).toBeUndefined();
});
it.each(["C:\\", "relative", "\\relative", "\\\\?\\C:\\data", "D:\\bad\nroot", {}, 123])(
	"rejects an invalid saved root %j",
	(value) => {
		expect(() => parseWindowsRegisteredDataRoot(value)).toThrow();
	},
);
