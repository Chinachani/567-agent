import { ipcMain, shell } from "electron";
import { type ReadRemoteHealth, readHealthReport, repairRuntimeHealth } from "../diagnostics/health-report.js";
import { buildDiagnosticsBundle } from "../diagnostics-bundle.js";
import { getAppLogBaseDir } from "../logger.js";

const DIAGNOSTICS_CHANNELS = {
	EXPORT: "vetta:diagnostics:export",
	REPORT: "agent567:diagnostics:report",
	REPAIR: "agent567:diagnostics:repair",
	GET_LOG_DIR: "vetta:diagnostics:get-log-dir",
} as const;

export { DIAGNOSTICS_CHANNELS };

export interface DiagnosticsExportResult {
	zipPath: string;
}

export function registerDiagnosticsIpc(readRemoteHealth?: ReadRemoteHealth): () => void {
	ipcMain.handle(
		DIAGNOSTICS_CHANNELS.EXPORT,
		async (_event, includeLogs: unknown): Promise<DiagnosticsExportResult> => {
			const { zipPath } = await buildDiagnosticsBundle({ includeLogs: includeLogs === true, readRemoteHealth });
			shell.showItemInFolder(zipPath);
			return { zipPath };
		},
	);

	ipcMain.handle(DIAGNOSTICS_CHANNELS.REPORT, () => readHealthReport(readRemoteHealth));
	ipcMain.handle(DIAGNOSTICS_CHANNELS.REPAIR, () => repairRuntimeHealth(readRemoteHealth));
	ipcMain.handle(DIAGNOSTICS_CHANNELS.GET_LOG_DIR, (): string => getAppLogBaseDir());

	return () => {
		ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.EXPORT);
		ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.REPORT);
		ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.REPAIR);
		ipcMain.removeHandler(DIAGNOSTICS_CHANNELS.GET_LOG_DIR);
	};
}
