import { useCallback, useEffect, useRef, useState } from "react";
import type { DiagnosticsReport } from "../../../../shared/diagnostics-report";

export function useDiagnosticsReport(open: boolean) {
	const [report, setReport] = useState<DiagnosticsReport | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState(false);
	const generation = useRef(0);
	const run = useCallback(async (repair = false) => {
		const current = ++generation.current;
		setBusy(true);
		setError(false);
		try {
			const value = repair
				? await window.agent567.diagnostics.repairRuntimes()
				: await window.agent567.diagnostics.readReport();
			if (current === generation.current) setReport(value);
		} catch {
			if (current === generation.current) setError(true);
		} finally {
			if (current === generation.current) setBusy(false);
		}
	}, []);
	useEffect(() => {
		if (!open) return;
		void run();
		return () => {
			generation.current++;
		};
	}, [open, run]);
	const exportBundle = async (includeLogs: boolean) => {
		if (busy) return;
		setBusy(true);
		setError(false);
		try {
			await window.agent567.diagnostics.exportDiagnosticsPackage(includeLogs);
		} catch {
			setError(true);
		} finally {
			setBusy(false);
		}
	};
	return { report, busy, error, run, exportBundle };
}
