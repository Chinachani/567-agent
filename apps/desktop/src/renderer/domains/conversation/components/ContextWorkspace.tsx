import { Tabs } from "radix-ui";
import { ContextSelectionPanel } from "./ContextSelectionPanel";
import { SessionAssetsPanel } from "./SessionAssetsPanel";
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
	const [tab, setTab] = useState(sessionId || sessionKey ? "context" : "attachment");
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
			<DialogContent className="flex h-[min(84dvh,820px)] min-h-0 min-w-0 w-[calc(100vw_-_2rem)] max-w-5xl flex-col overflow-hidden">
				<DialogHeader className="shrink-0 pr-6">
					<DialogTitle>{t("workbench.title")}</DialogTitle>
					<DialogDescription>{t("contextWorkspace.hint")}</DialogDescription>
				</DialogHeader>
				<Tabs.Root
					value={tab}
					onValueChange={setTab}
					className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden"
				>
					<Tabs.List
						className="flex w-full min-w-0 shrink-0 gap-1 rounded-lg bg-muted/40 p-1"
						aria-label={t("workbench.title")}
					>
						{(["context", "attachment", "task", "change"] as const).map((key) => (
							<Tabs.Trigger
								key={key}
								value={key}
								disabled={assets.reviewing}
								className="min-w-0 flex-1 basis-0 truncate rounded-md px-2 py-1.5 text-[12px] text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground"
							>
								{t(`workbench.tab.${key}`)}
							</Tabs.Trigger>
						))}
					</Tabs.List>
					<Tabs.Content
						value="context"
						forceMount
						className="min-h-0 min-w-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
					>
						<ContextSelectionPanel model={model} hasSession={sessionId !== null || Boolean(sessionKey)} />
					</Tabs.Content>
					{(["attachment", "task", "change"] as const).map((section) => (
						<Tabs.Content
							key={section}
							value={section}
							forceMount
							className="min-h-0 min-w-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
						>
							<SessionAssetsPanel model={assets} section={section} />
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
