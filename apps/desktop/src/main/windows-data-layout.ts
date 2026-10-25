import { join, win32 } from "node:path";
import { readWindowsRegisteredDataRoot } from "./windows-data-root.js";

export const WINDOWS_DATA_ROOT_ENV = "AGENT567_WINDOWS_DATA_ROOT";
export const WINDOWS_ELECTRON_USER_DATA_ENV = "AGENT567_DESKTOP_USER_DATA_DIR";
export const WINDOWS_UPDATE_STORE_ENV = "AGENT567_WINDOWS_UPDATE_STORE";
export const WINDOWS_UPDATER_CACHE_ENV = "AGENT567_UPDATER_CACHE_DIR";

export interface WindowsDataLayout {
	dataRoot: string | null;
	userData: string;
	sessionData: string;
	logs: string;
	updateStore: string;
	updaterCache: string;
}

export function resolveWindowsDataLayout(
	options: {
		dataRoot?: string;
		userData?: string;
		updateStore?: string;
		updaterCache?: string;
		localAppData?: string;
		appData?: string;
	},
	appName = "567-agent",
): WindowsDataLayout {
	const dataRoot = options.dataRoot?.trim() ? win32.resolve(options.dataRoot.trim()) : null;
	const localAppData = options.localAppData?.trim();
	const localRoot = localAppData ? win32.join(localAppData, "567Agent") : "";
	const userData = options.userData?.trim()
		? win32.resolve(options.userData.trim())
		: dataRoot
			? win32.join(dataRoot, "electron-user-data")
			: win32.join(options.appData || process.env.APPDATA || "", appName);
	return {
		dataRoot,
		userData,
		sessionData: userData,
		logs: win32.join(userData, "logs"),
		updateStore: options.updateStore?.trim()
			? win32.resolve(options.updateStore.trim())
			: dataRoot
				? win32.join(dataRoot, "windows-updates")
				: localRoot,
		updaterCache: options.updaterCache?.trim()
			? win32.resolve(options.updaterCache.trim())
			: dataRoot
				? win32.join(dataRoot, "updater-cache")
				: localAppData
					? win32.resolve(localAppData)
					: join(process.cwd(), "567-agent-updater"),
	};
}

export function resolveWindowsDataLayoutFromEnvironment(
	environment: NodeJS.ProcessEnv = process.env,
): WindowsDataLayout {
	return resolveWindowsDataLayout({
		dataRoot: environment[WINDOWS_DATA_ROOT_ENV],
		userData: environment[WINDOWS_ELECTRON_USER_DATA_ENV],
		updateStore: environment[WINDOWS_UPDATE_STORE_ENV],
		updaterCache: environment[WINDOWS_UPDATER_CACHE_ENV],
		localAppData: environment.LOCALAPPDATA,
		appData: environment.APPDATA,
	});
}

/** Every installed entry point uses the saved root even when it bypasses the launcher. */
export function resolveWindowsDataLayoutForProcess(
	environment: NodeJS.ProcessEnv = process.env,
	readRegisteredRoot: () => string | null = readWindowsRegisteredDataRoot,
): WindowsDataLayout {
	const selectedRoot = environment[WINDOWS_DATA_ROOT_ENV]?.trim() || readRegisteredRoot();
	return resolveWindowsDataLayoutFromEnvironment({
		...environment,
		[WINDOWS_DATA_ROOT_ENV]: selectedRoot ?? undefined,
	});
}
