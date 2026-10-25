import { statSync } from "node:fs";
import {
	resolveWindowsDataLayoutForProcess,
	WINDOWS_DATA_ROOT_ENV,
	WINDOWS_ELECTRON_USER_DATA_ENV,
	WINDOWS_UPDATE_STORE_ENV,
	WINDOWS_UPDATER_CACHE_ENV,
} from "./windows-data-layout.js";

export function initializeWindowsDataEnvironment(
	environment: NodeJS.ProcessEnv = process.env,
	readRegisteredRoot?: () => string | null,
): void {
	const layout = resolveWindowsDataLayoutForProcess(environment, readRegisteredRoot);
	if (!layout.dataRoot) return;
	if (!statSync(layout.dataRoot).isDirectory())
		throw new Error(`The saved 567 Agent data folder is unavailable: ${layout.dataRoot}`);
	environment[WINDOWS_DATA_ROOT_ENV] = layout.dataRoot;
	environment.AGENT567_HOME ||= layout.dataRoot;
	environment[WINDOWS_ELECTRON_USER_DATA_ENV] ||= layout.userData;
	environment[WINDOWS_UPDATE_STORE_ENV] ||= layout.updateStore;
	environment[WINDOWS_UPDATER_CACHE_ENV] ||= layout.updaterCache;
}
