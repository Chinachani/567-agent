import { stat } from "node:fs/promises";
import { readDesktopConfig, updateDesktopConfig } from "../config/desktop-config-store.js";
import { allowProjectRoot, createFilesystemDirectory } from "../filesystem/filesystem-service.js";
import { broadcastProjectsChanged } from "./project-events.js";
import { ProjectService } from "./project-service.js";

/** Create the shared project service with the desktop's filesystem and config boundaries. */
export function createDesktopProjectService(): ProjectService {
	return new ProjectService({
		allowProjectRoot,
		createDirectory: createFilesystemDirectory,
		readConfig: readDesktopConfig,
		updateConfig: updateDesktopConfig,
		broadcastChanged: broadcastProjectsChanged,
		isExistingNonDirectory: async (path) => {
			try {
				return !(await stat(path)).isDirectory();
			} catch {
				return false;
			}
		},
	});
}
