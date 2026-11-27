import { Tabs } from "radix-ui";
import { ContextSelectionPanel } from "./ContextSelectionPanel";
import { SessionAssetsPanel } from "./SessionAssetsPanel";
import { TurnFileRestoreDialog } from "./TurnFileRestoreDialog";
import { useSessionWorkbench } from "../hooks/useSessionWorkbench";
import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@shared/components/ui/dialog";
import { attachedImagesAtom, mentionedFilesAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useContextWorkspace } from "../hooks/useContextWorkspace";

interface ContextWorkspaceProps {
	sessionId: string | null;
	/** Presentation identity stays stable while an existing conversation acquires its Runtime. */
	sessionKey?: string | null;
}
export function ContextWorkspace({ sessionId, sessionKey }: ContextWorkspaceProps): JSX.Element {
	return <SessionContextWorkspace key={sessionKey ?? sessionId ?? "draft"} sessionId={sessionId} sessionKey={sessionKey} />;
}
function SessionContextWorkspace({ sessionId, sessionKey }: ContextWorkspaceProps): JSX.Element {
	const { t } = useTranslation("chat");
	const [open, setOpen] = useState(false);
	const [discard, setDiscard] = useState(false);
	const model = useContextWorkspace(sessionId, open);
	const assets = useSessionWorkbench(sessionId, open);
	const pendingFiles = useAtomValue(mentionedFilesAtom);
	const pendingImages = useAtomValue(attachedImagesAtom);
	const pendingAttachmentCount = pendingFiles.length + pendingImages.length;
	const [tab, setTab] = useState(sessionId || sessionKey ? "context" : "attachment");
	const isReadOnly = Boolean(model.snapshot?.busy || model.busy || assets.reviewing);
	const tabCounts: Record<"context" | "attachment" | "task" | "change", number> = {
		context: 0,
		attachment: pendingAttachmentCount + (assets.snapshot?.attachments.length ?? 0),
		task: assets.snapshot?.tasks.length ?? 0,
		change: assets.snapshot?.changes.length ?? 0,
	};
	return (
		<Dialog
			open={open}
			onOpenChange={(value) => {
				if (!value && (model.busy || assets.reviewing)) return;
				if (!value && model.dirty) {
					setDiscard(true);
					return;
				}
				setOpen(value);
			}}
		>
			<DialogTrigger asChild>
				<Button
					size="icon"
					variant="ghost"
					className="h-7 w-7"
					aria-label={t("workbench.title")}
					title={t("workbench.title")}
				>
					<span className="icon-[solar--document-text-linear] h-3.5 w-3.5" aria-hidden="true" />
				</Button>
			</DialogTrigger>
			<DialogContent className="flex h-[min(86dvh,840px)] min-h-0 min-w-0 w-[calc(100vw_-_2rem)] max-w-5xl flex-col overflow-hidden">
				<DialogHeader className="shrink-0 pr-6">
					<div className="flex flex-wrap items-center gap-2">
						<DialogTitle>{t("workbench.title")}</DialogTitle>
						{model.dirty && (
							<span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
								{t("contextWorkspace.unsavedBadge")}
							</span>
						)}
						{isReadOnly && (
							<span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
								{t("contextWorkspace.readOnlyBadge")}
							</span>
						)}
					</div>
					<DialogDescription className="text-[12px]">{t("contextWorkspace.hint")}</DialogDescription>
				</DialogHeader>
				<Tabs.Root
					value={tab}
					onValueChange={setTab}
					className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden"
				>
					<Tabs.List
						className="flex w-full min-w-0 shrink-0 gap-1 rounded-lg border border-border/50 bg-muted/40 p-1"
						aria-label={t("workbench.title")}
					>
						{(["context", "attachment", "task", "change"] as const).map((key) => (
							<Tabs.Trigger
								key={key}
								value={key}
								disabled={assets.reviewing}
								className="flex min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-muted-foreground transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:font-medium data-[state=active]:text-foreground"
							>
								<span className="truncate">{t(`workbench.tab.${key}`)}</span>
								{key === "context" && model.dirty && (
									<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
								)}
								{tabCounts[key] > 0 && (
									<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
										{tabCounts[key]}
									</span>
								)}
							</Tabs.Trigger>
						))}
					</Tabs.List>
					<Tabs.Content
						value="context"
						forceMount
						className="min-h-0 min-w-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
					>
						<ContextSelectionPanel
							model={model}
							hasSession={sessionId !== null || Boolean(sessionKey)}
							pendingAttachmentCount={pendingAttachmentCount}
						/>
					</Tabs.Content>
					{(["attachment", "task", "change"] as const).map((section) => (
						<Tabs.Content
							key={section}
							value={section}
							forceMount
							className="min-h-0 min-w-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
						>
							<div className="flex h-full min-h-0 flex-col gap-3">
								{section === "change" && sessionId && <TurnFileRestoreDialog key={sessionId} sessionId={sessionId} />}
								<div className="min-h-0 flex-1"><SessionAssetsPanel model={assets} section={section} /></div>
							</div>
						</Tabs.Content>
					))}
				</Tabs.Root>
				<Dialog open={discard} onOpenChange={setDiscard}>
					<DialogContent>
						<DialogTitle>{t("contextWorkspace.discardTitle")}</DialogTitle>
						<DialogDescription>{t("contextWorkspace.discardHint")}</DialogDescription>
						<div className="flex justify-end gap-2">
							<Button variant="ghost" onClick={() => setDiscard(false)}>
								{t("contextWorkspace.continueEditing")}
							</Button>
							<Button
								variant="outline"
								onClick={() => {
									model.reset();
									setDiscard(false);
									setOpen(false);
								}}
							>
								{t("contextWorkspace.discard")}
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</DialogContent>
		</Dialog>
	);
}
