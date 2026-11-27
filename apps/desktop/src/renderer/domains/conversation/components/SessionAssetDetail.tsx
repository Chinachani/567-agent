import type { SessionChangeAsset, SessionTaskAsset } from "@567agent/remote-control";
import { MarkdownContent } from "./blocks/TextBlock";
import { formatBytes, formatDurationCompact } from "./blocks/tool-views/shared/format";
import { EditDiffView } from "./blocks/tool-views/EditDiffView";
import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@shared/components/ui/dialog";
import { filePreviewAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionWorkbenchModel } from "../hooks/useSessionWorkbench";

export function taskBadgeClass(status: string): string {
	if (status === "failed") return "bg-destructive/15 text-destructive";
	if (status === "completed") return "bg-emerald-500/15 text-emerald-400";
	if (status === "running") return "bg-primary/10 text-primary";
	return "bg-amber-500/15 text-amber-400";
}

export function reviewBadgeClass(status: string): string {
	if (status === "kept") return "bg-emerald-500/15 text-emerald-400";
	if (status === "reverted") return "bg-muted text-muted-foreground";
	return "bg-amber-500/15 text-amber-400";
}

export function SessionAssetDetail({
	model,
	onClose,
	taskMeta,
	changeMeta,
}: {
	model: SessionWorkbenchModel;
	onClose: () => void;
	taskMeta?: SessionTaskAsset;
	changeMeta?: SessionChangeAsset;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const preview = useSetAtom(filePreviewAtom);
	const [confirm, setConfirm] = useState(false);
	const detail = model.detail;
	const changeStatus = changeMeta?.status ?? "pending";
	const hasDiffOrSnapshot = Boolean(
		detail?.text || detail?.beforeText !== undefined || detail?.afterText !== undefined,
	);
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card/20">
			<div className="flex shrink-0 items-start gap-2 border-b border-border p-3">
				<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
					<h3 className="min-w-0 break-words text-[13px] font-medium [overflow-wrap:anywhere]">
						{detail?.title || t("workbench.loading")}
					</h3>
					{detail?.kind === "task" && taskMeta && (
						<span
							className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${taskBadgeClass(taskMeta.status)}`}
						>
							{t(`workbench.status.${taskMeta.status}`)}
						</span>
					)}
					{detail?.kind === "change" && (
						<>
							<span
								className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${reviewBadgeClass(changeStatus)}`}
							>
								{t(`workbench.review.${changeStatus}`)}
							</span>
							{detail.reversible && changeStatus !== "reverted" && (
								<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
									{t("workbench.reversible")}
								</span>
							)}
						</>
					)}
					{detail && detail.kind !== "change" && (
						<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
							{t("workbench.readOnlyDetail")}
						</span>
					)}
				</div>
				<Button size="xs" variant="ghost" className="shrink-0" disabled={model.reviewing} onClick={onClose}>
					<span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5 md:hidden" aria-hidden="true" />
					{t("workbench.close")}
				</Button>
			</div>
			<div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-auto overscroll-contain p-4 [overflow-wrap:anywhere] [scrollbar-gutter:stable]">
				{!detail && (
					<p role="status" className="text-[12px] text-muted-foreground">
						{t(model.error ? "workbench.failed" : "workbench.loading")}
					</p>
				)}
				{detail?.kind === "attachment" && (
					<>
						<p className="break-all text-[11px] tabular-nums text-muted-foreground">
							{detail.path} · {formatBytes(detail.sizeBytes)}
						</p>
						<p className="text-[12px] text-muted-foreground">
							{t(`workbench.preview.${detail.previewStatus ?? "unavailable"}`)}
						</p>
						{detail.thumbnailDataUrl && /^data:image\/(png|jpeg);base64,/.test(detail.thumbnailDataUrl) && (
							<img
								src={detail.thumbnailDataUrl}
								alt={detail.title}
								className="max-h-72 max-w-full rounded-lg border border-border/50 object-contain"
							/>
						)}
						{detail.text && (
							<pre className="whitespace-pre-wrap rounded-lg border border-border/50 bg-background/60 p-3 font-mono text-[12px] leading-relaxed">
								{detail.text}
							</pre>
						)}
					</>
				)}
				{detail?.kind === "task" && (
					<>
						{taskMeta && (
							<p className="text-[11px] tabular-nums text-muted-foreground">
								{new Date(taskMeta.timestamp).toLocaleString()} ·{" "}
								{taskMeta.durationMs === null ? "—" : formatDurationCompact(taskMeta.durationMs)} ·{" "}
								{t("workbench.tools", { count: taskMeta.toolCount })}
							</p>
						)}
						{detail.text.trim() ? (
							<MarkdownContent text={detail.text} className="min-w-0 text-[13px]" />
						) : (
							<p className="text-[12px] text-muted-foreground">{t("workbench.taskNoOutput")}</p>
						)}
					</>
				)}
				{detail?.kind === "change" && (
					<>
						{hasDiffOrSnapshot ? (
							<EditDiffView
								block={{
									args: { oldText: detail.beforeText, newText: detail.afterText },
									uiDetails: { diff: detail.text },
								}}
							/>
						) : (
							<p className="text-[12px] text-muted-foreground">{t("workbench.changeNoDiff")}</p>
						)}
						{detail.beforeText !== undefined && (
							<details className="rounded-lg border border-border/50 bg-background/60 p-2.5">
								<summary className="cursor-pointer text-[12px] font-medium">{t("workbench.before")}</summary>
								<pre className="mt-2 whitespace-pre-wrap font-mono text-[12px] text-muted-foreground">
									{detail.beforeText}
								</pre>
							</details>
						)}
						{detail.afterText !== undefined && (
							<details className="rounded-lg border border-border/50 bg-background/60 p-2.5">
								<summary className="cursor-pointer text-[12px] font-medium">{t("workbench.after")}</summary>
								<pre className="mt-2 whitespace-pre-wrap font-mono text-[12px]">{detail.afterText}</pre>
							</details>
						)}
					</>
				)}
			</div>
			{detail?.kind === "attachment" && (
				<div className="shrink-0 border-t border-border p-3">
					<Button
						size="sm"
						variant="outline"
						disabled={!detail.path || detail.previewStatus === "unavailable"}
						onClick={() => {
							if (detail.path) preview({ path: detail.path, name: detail.title });
						}}
					>
						{t("workbench.previewOriginal")}
					</Button>
				</div>
			)}
			{detail?.kind === "change" && (
				<div className="shrink-0 space-y-2 border-t border-border p-3">
					<p className="text-[11px] text-muted-foreground">
						{t(
							changeStatus === "reverted"
								? "workbench.changeRevertedNotice"
								: changeStatus === "kept"
									? "workbench.changeKeptNotice"
									: detail.reversible
										? "workbench.revertHint"
										: "workbench.changeUnavailableNotice",
						)}
					</p>
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="outline"
							disabled={model.busy || changeStatus === "kept" || changeStatus === "reverted"}
							onClick={() => void model.review("keep")}
						>
							{t("workbench.keep")}
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={model.busy || !detail.reversible}
							onClick={() => setConfirm(true)}
						>
							{t("workbench.revert")}
						</Button>
					</div>
				</div>
			)}
			<Dialog open={confirm} onOpenChange={setConfirm}>
				<DialogContent>
					<DialogTitle>{t("workbench.revert")}</DialogTitle>
					<DialogDescription>{t("workbench.revertConfirm")}</DialogDescription>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" disabled={model.busy} onClick={() => setConfirm(false)}>
							{t("workbench.cancel")}
						</Button>
						<Button
							variant="primary"
							disabled={model.busy}
							onClick={() => {
								setConfirm(false);
								void model.review("revert");
							}}
						>
							{t("workbench.confirm")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
