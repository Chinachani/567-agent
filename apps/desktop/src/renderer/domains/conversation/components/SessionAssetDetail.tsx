import { MarkdownContent } from "./blocks/TextBlock";
import { EditDiffView } from "./blocks/tool-views/EditDiffView";
import { Button } from "@shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@shared/components/ui/dialog";
import { filePreviewAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionWorkbenchModel } from "../hooks/useSessionWorkbench";

export function SessionAssetDetail({
	model,
	onClose,
}: {
	model: SessionWorkbenchModel;
	onClose: () => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const preview = useSetAtom(filePreviewAtom);
	const [confirm, setConfirm] = useState(false);
	const detail = model.detail;
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border">
			<div className="flex shrink-0 items-start gap-2 border-b border-border p-3">
				<h3 className="min-w-0 flex-1 break-words text-[13px] font-medium [overflow-wrap:anywhere]">
					{detail?.title || t("workbench.loading")}
				</h3>
				<Button size="xs" variant="ghost" className="shrink-0" disabled={model.reviewing} onClick={onClose}>
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
						<p className="text-[11px] text-muted-foreground">
							{detail.path} · {detail.sizeBytes ?? "—"} bytes
						</p>
						<p className="text-[12px] text-muted-foreground">
							{t(`workbench.preview.${detail.previewStatus ?? "unavailable"}`)}
						</p>
						{detail.text && <pre className="whitespace-pre-wrap text-[12px]">{detail.text}</pre>}
					</>
				)}
				{detail?.kind === "task" && <MarkdownContent text={detail.text} className="min-w-0 text-[13px]" />}
				{detail?.kind === "change" && (
					<>
						<EditDiffView
							block={{
								args: { oldText: detail.beforeText, newText: detail.afterText },
								uiDetails: { diff: detail.text },
							}}
						/>
						{detail.beforeText !== undefined && (
							<details>
								<summary className="cursor-pointer text-[12px]">{t("workbench.before")}</summary>
								<pre className="mt-2 whitespace-pre-wrap text-[12px] text-muted-foreground">
									{detail.beforeText}
								</pre>
							</details>
						)}
						{detail.afterText !== undefined && (
							<details>
								<summary className="cursor-pointer text-[12px]">{t("workbench.after")}</summary>
								<pre className="mt-2 whitespace-pre-wrap text-[12px]">{detail.afterText}</pre>
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
					<p className="text-[11px] text-muted-foreground">{t("workbench.revertHint")}</p>
					<div className="flex flex-wrap gap-2">
						<Button size="sm" variant="outline" disabled={model.busy} onClick={() => void model.review("keep")}>
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
				</DialogContent>
			</Dialog>
		</div>
	);
}
