import type { DiagnosticsReport } from "../../shared/diagnostics-report.js";
export interface DiagnosticsExportResult {
	zipPath: string;
}

export interface DesktopDiagnosticsApi {
	readReport(): Promise<DiagnosticsReport>;
	repairRuntimes(): Promise<DiagnosticsReport>;
	exportDiagnosticsPackage(includeLogs?: boolean): Promise<DiagnosticsExportResult>;
	getLogDir(): Promise<string>;
}
