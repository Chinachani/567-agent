import { type PluginFilePreviewProps, useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState, type JSX } from "react";
import { fetchFileBytes } from "../../utils/file";
import { ErrorState, LoadingState, type LoadState } from "../PreviewState";
import { parseWorkbook } from "./parseWorkbook";
import { SheetTabs } from "./SheetTabs";
import type { SheetModel } from "./types";
import { VirtualSheet } from "./VirtualSheet";

export function SpreadsheetPreview({ file }: PluginFilePreviewProps): JSX.Element {
	const { t } = useTranslation();
	const [status, setStatus] = useState<LoadState>("loading");
	const [sheets, setSheets] = useState<SheetModel[]>([]);
	const [activeSheet, setActiveSheet] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setStatus("loading");
		setActiveSheet(0);
		void fetchFileBytes(file)
			.then((bytes) => parseWorkbook(bytes, file.extension))
			.then((nextSheets) => {
				if (cancelled) return;
				setSheets(nextSheets);
				setStatus("ready");
			})
			.catch(() => {
				if (!cancelled) setStatus("error");
			});
		return () => {
			cancelled = true;
		};
	}, [file]);

	const sheet = sheets[activeSheet];
	return (
		<div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--background)]">
			{status === "ready" && sheet && <VirtualSheet sheet={sheet} />}
			{status === "ready" && sheet && sheet.appearance !== "styles" && (
				<p className="shrink-0 border-t border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--muted-foreground)]">
					{t(sheet.appearance === "plain" ? "spreadsheet.plainTextHint" : "spreadsheet.basicAppearanceHint")}
				</p>
			)}
			{status === "ready" && sheets.length > 0 && (
				<SheetTabs sheets={sheets} activeSheet={activeSheet} onSelect={setActiveSheet} />
			)}
			{status === "loading" && (
				<div className="absolute inset-0 bg-[var(--background)]">
					<LoadingState />
				</div>
			)}
			{status === "error" && (
				<div className="absolute inset-0 bg-[var(--background)]">
					<ErrorState message={t("spreadsheet.error")} />
				</div>
			)}
		</div>
	);
}
