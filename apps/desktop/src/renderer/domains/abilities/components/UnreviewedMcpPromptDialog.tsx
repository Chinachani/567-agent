import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@vetta-org/ui";
import { Textarea } from "../../../shared/components/ui/textarea";
import { showToast } from "../../../shared/store/toast-atoms";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { McpAbility } from "../types";
import {
	getUnreviewedMcpDocumentationUrl,
	getUnreviewedMcpRepositoryUrl,
	interpolateUnreviewedMcpPrompt,
} from "../lib/unreviewed-mcp-prompt";

export function UnreviewedMcpPromptDialog({
	item,
	open,
	onOpenChange,
}: {
	item: McpAbility | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}): JSX.Element | null {
	const { t, i18n } = useTranslation(["abilities", "common"]);
	const [confirmed, setConfirmed] = useState(false);
	const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
	const prompt = useMemo(() => {
		if (!item) return "";
		const detail = item.market?.detail;
		const language = i18n.language.toLowerCase().startsWith("zh") ? "zh" : "en";
		const documentation =
			getUnreviewedMcpDocumentationUrl(detail?.i18n?.[language]?.meta) ||
			getUnreviewedMcpDocumentationUrl(detail?.meta) ||
			t("unreviewedMcp.metadataNotProvided");
		const declaredRepository =
			getUnreviewedMcpRepositoryUrl(detail?.i18n?.[language]?.meta) ||
			getUnreviewedMcpRepositoryUrl(detail?.meta);
		const catalogRepository =
			item.origin?.repository || (item.catalogSource.kind === "github" ? item.catalogSource.repository : "");
		return interpolateUnreviewedMcpPrompt(t("unreviewedMcp.prompt"), {
			name: item.title || t("unreviewedMcp.metadataNotProvided"),
			description: item.description || t("unreviewedMcp.metadataNotProvided"),
			author: item.author || detail?.author || t("unreviewedMcp.metadataNotProvided"),
			version: item.version || t("unreviewedMcp.metadataNotProvided"),
			license: item.license || detail?.license || t("unreviewedMcp.metadataNotProvided"),
			documentation,
			repositoryLabel: declaredRepository
				? t("unreviewedMcp.projectRepository")
				: t("unreviewedMcp.catalogSource"),
			repository: declaredRepository || catalogRepository || t("unreviewedMcp.metadataNotProvided"),
		});
	}, [i18n.language, item, t]);

	useEffect(() => {
		if (!open) return;
		setConfirmed(false);
		setCopyState("idle");
	}, [open, item?.id]);

	if (!item) return null;

	const copyPrompt = async (): Promise<void> => {
		if (!confirmed) return;
		try {
			await navigator.clipboard.writeText(prompt);
			setCopyState("copied");
			showToast({ variant: "success", message: t("unreviewedMcp.copied"), durationMs: 5000 });
		} catch {
			setCopyState("failed");
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onOpenChange(false);
			}}
		>
			<DialogContent className="max-h-[82vh] max-w-2xl overflow-y-auto">
				<DialogHeader>
					<DialogTitle>{t("unreviewedMcp.title")}</DialogTitle>
					<DialogDescription>{t("unreviewedMcp.description")}</DialogDescription>
				</DialogHeader>

				<div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] leading-relaxed text-destructive">
					{t("unreviewedMcp.warning")}
				</div>

				<label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/50 px-3 py-2.5 text-[12px] leading-relaxed text-foreground">
					<input
						type="checkbox"
						className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--primary)]"
						checked={confirmed}
						onChange={(event) => {
							setConfirmed(event.currentTarget.checked);
							setCopyState("idle");
						}}
					/>
					<span>{t("unreviewedMcp.consent")}</span>
				</label>

				{confirmed && (
					<div className="flex flex-col gap-1.5">
						<label htmlFor="unreviewed-mcp-prompt" className="text-[11px] font-medium text-muted-foreground">
							{t("unreviewedMcp.promptLabel")}
						</label>
						<Textarea
							id="unreviewed-mcp-prompt"
							readOnly
							value={prompt}
							rows={12}
							className="max-h-64 min-h-40 select-text overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed"
						/>
					</div>
				)}

				{copyState === "copied" && (
					<p role="status" className="text-[12px] text-emerald-400">
						{t("unreviewedMcp.copied")}
					</p>
				)}
				{copyState === "failed" && (
					<p role="status" className="text-[12px] text-destructive">
						{t("unreviewedMcp.copyFailed")}
					</p>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common:actions.cancel")}
					</Button>
					<Button variant="primary" disabled={!confirmed} onClick={() => void copyPrompt()}>
						<span className="icon-[solar--copy-linear] h-3.5 w-3.5" />
						{t("unreviewedMcp.copy")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
