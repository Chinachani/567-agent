import { describe, expect, it } from "vitest";
import {
	resolveWindowsDataLayout,
	resolveWindowsDataLayoutForProcess,
	resolveWindowsDataLayoutFromEnvironment,
	WINDOWS_DATA_ROOT_ENV,
	WINDOWS_ELECTRON_USER_DATA_ENV,
	WINDOWS_UPDATE_STORE_ENV,
	WINDOWS_UPDATER_CACHE_ENV,
} from "./windows-data-layout.js";

describe("resolveWindowsDataLayout", () => {
	it("places persistent application state and update files under the selected root", () => {
		expect(resolveWindowsDataLayout({ dataRoot: "D:\\567 Agent Data" })).toEqual({
			dataRoot: "D:\\567 Agent Data",
			userData: "D:\\567 Agent Data\\electron-user-data",
			sessionData: "D:\\567 Agent Data\\electron-user-data",
			logs: "D:\\567 Agent Data\\electron-user-data\\logs",
			updateStore: "D:\\567 Agent Data\\windows-updates",
			updaterCache: "D:\\567 Agent Data\\updater-cache",
		});
	});

	it("preserves the existing locations when no custom root has been saved", () => {
		expect(
			resolveWindowsDataLayout({
				localAppData: "C:\\Users\\test\\AppData\\Local",
				appData: "C:\\Users\\test\\AppData\\Roaming",
			}),
		).toEqual({
			dataRoot: null,
			userData: "C:\\Users\\test\\AppData\\Roaming\\567-agent",
			sessionData: "C:\\Users\\test\\AppData\\Roaming\\567-agent",
			logs: "C:\\Users\\test\\AppData\\Roaming\\567-agent\\logs",
			updateStore: "C:\\Users\\test\\AppData\\Local\\567Agent",
			updaterCache: "C:\\Users\\test\\AppData\\Local",
		});
	});

	it("uses explicit process environment values from the launcher", () => {
		expect(
			resolveWindowsDataLayoutFromEnvironment({
				[WINDOWS_DATA_ROOT_ENV]: "D:\\Data",
				[WINDOWS_ELECTRON_USER_DATA_ENV]: "E:\\Profile",
				[WINDOWS_UPDATE_STORE_ENV]: "E:\\Updates",
				[WINDOWS_UPDATER_CACHE_ENV]: "E:\\Cache",
				LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
				APPDATA: "C:\\Users\\test\\AppData\\Roaming",
			}),
		).toEqual({
			dataRoot: "D:\\Data",
			userData: "E:\\Profile",
			sessionData: "E:\\Profile",
			logs: "E:\\Profile\\logs",
			updateStore: "E:\\Updates",
			updaterCache: "E:\\Cache",
		});
	});

	it("does not mistake the normal AGENT567_HOME default for an installer-selected Windows root", () => {
		expect(
			resolveWindowsDataLayoutFromEnvironment({
				AGENT567_HOME: "C:\\Users\\test\\.567agent",
				LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
				APPDATA: "C:\\Users\\test\\AppData\\Roaming",
			}),
		).toMatchObject({
			dataRoot: null,
			userData: "C:\\Users\\test\\AppData\\Roaming\\567-agent",
			updateStore: "C:\\Users\\test\\AppData\\Local\\567Agent",
		});
	});
	it("uses the saved Unicode data root without launcher variables for both state and updates", () => {
		const environment = {
			APPDATA: "C:\\Users\\test\\AppData\\Roaming",
			LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
		};
		const layout = resolveWindowsDataLayoutForProcess(environment, () => "D:\\数据 目录");
		expect(layout).toMatchObject({
			dataRoot: "D:\\数据 目录",
			userData: "D:\\数据 目录\\electron-user-data",
			updateStore: "D:\\数据 目录\\windows-updates",
			updaterCache: "D:\\数据 目录\\updater-cache",
		});
	});
	it("keeps explicit launcher paths and fails closed if the saved root cannot be read", () => {
		expect(
			resolveWindowsDataLayoutForProcess({ AGENT567_WINDOWS_DATA_ROOT: "E:\\Explicit" }, () => {
				throw new Error("must not query");
			}).dataRoot,
		).toBe("E:\\Explicit");
		expect(() =>
			resolveWindowsDataLayoutForProcess({}, () => {
				throw new Error("registry denied");
			}),
		).toThrow("registry denied");
	});
});
