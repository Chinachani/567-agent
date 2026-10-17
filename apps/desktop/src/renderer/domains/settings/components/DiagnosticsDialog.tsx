import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@shared/components/ui/dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDiagnosticsReport } from "./useDiagnosticsReport";

export function DiagnosticsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const model = useDiagnosticsReport(open);
	const [includeLogs, setIncludeLogs] = useState(false);
	const [confirm, setConfirm] = useState(false);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="h-[min(80dvh,760px)] min-w-0 max-w-[min(44rem,calc(100%-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
				<DialogHeader>
					<DialogTitle>{t("diagnostics.title")}</DialogTitle>
					<DialogDescription>{t("diagnostics.description")}</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 min-w-0 space-y-4 overflow-y-auto overscroll-contain [overflow-wrap:anywhere] [scrollbar-gutter:stable]">
					{model.busy && (
						<p role="status" className="text-[12px] text-muted-foreground">
							{t("diagnostics.working")}
						</p>
					)}
					{model.error && (
						<p role="alert" className="text-[12px] text-destructive">
							{t("diagnostics.failed")}
						</p>
					)}
					<div className="divide-y divide-border/40 rounded-xl border border-border/50 px-4">
						{model.report?.checks.map((check) => (
							<div key={check.id} className="py-3">
								<div className="flex justify-between gap-3 text-[13px]">
									<span>{t(`diagnostics.check.${check.id}`)}</span>
									<span
										className={check.status === "attention" ? "text-destructive" : "text-muted-foreground"}
									>
										<span
											aria-hidden="true"
											className={`mr-1 text-[10px] ${check.status === "ok" ? "text-emerald-400" : check.status === "attention" ? "text-amber-400" : "text-muted-foreground"}`}
										>
											●
										</span>
										{t(`diagnostics.status.${check.status}`)}
									</span>
								</div>
								{check.status !== "ok" && (
									<p className="mt-1 text-[11px] text-muted-foreground">{t(`diagnostics.hint.${check.id}`)}</p>
								)}
							</div>
						))}
					</div>
					{model.report && (
						<details>
							<summary className="cursor-pointer text-[12px] text-muted-foreground">
								{t("diagnostics.preview")}
							</summary>
							<pre className="mt-2 whitespace-pre-wrap break-words rounded-xl bg-muted/40 p-3 text-[11px]">
								{model.report.text}
							</pre>
						</details>
					)}
					<label className="flex items-start gap-2 text-[12px]">
						<input
							type="checkbox"
							checked={includeLogs}
							onChange={(event) => setIncludeLogs(event.target.checked)}
						/>
						<span>
							{t("diagnostics.includeLogs")}
							<span className="mt-1 block text-[11px] text-muted-foreground">{t("diagnostics.privacy")}</span>
						</span>
					</label>
				</div>
				<div className="shrink-0 space-y-3 border-t border-border/40 pt-3">
					{confirm && (
						<div className="space-y-2 rounded-xl border border-border/50 bg-muted/40 p-3">
							<p className="text-[12px]">{t("diagnostics.repairConfirm")}</p>
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="primary"
									disabled={model.busy}
									onClick={() => {
										setConfirm(false);
										void model.run(true);
									}}
								>
									{t("diagnostics.confirmRepair")}
								</Button>
								<Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
									{t("diagnostics.cancel")}
								</Button>
							</div>
						</div>
					)}
					<div className="flex flex-wrap justify-end gap-2">
						<Button size="sm" variant="ghost" disabled={model.busy} onClick={() => void model.run()}>
							{t("diagnostics.refresh")}
						</Button>
						<Button size="sm" variant="outline" disabled={model.busy} onClick={() => setConfirm(true)}>
							{t("diagnostics.repair")}
						</Button>
						<Button
							size="sm"
							variant="primary"
							disabled={model.busy || !model.report}
							onClick={() => void model.exportBundle(includeLogs)}
						>
							{t("diagnostics.export")}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
