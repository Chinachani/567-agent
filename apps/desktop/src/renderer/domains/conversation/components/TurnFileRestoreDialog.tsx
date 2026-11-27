import { Button } from "@shared/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@shared/components/ui/dialog";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	TurnFileRestoreEntry,
	TurnFileRestorePreview,
	TurnFilesSummary,
} from "../../../../shared/session-workbench-ipc";

export function TurnFileRestoreDialog({ sessionId }: { sessionId: string }): JSX.Element {
	const { t } = useTranslation("chat");
	const [open, setOpen] = useState(false);
	const [restoring, setRestoring] = useState(false);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!restoring) setOpen(next);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm" className="shrink-0 self-start">
					{t("workbench.turnFiles.open")}
				</Button>
			</DialogTrigger>
			<DialogContent className="flex max-h-[80dvh] flex-col overflow-hidden">
				<DialogHeader>
					<DialogTitle>{t("workbench.turnFiles.open")}</DialogTitle>
					<DialogDescription>{t("workbench.turnFiles.hint")}</DialogDescription>
				</DialogHeader>
				{open && <TurnFileRestoreContent sessionId={sessionId} restoring={restoring} setRestoring={setRestoring} />}
			</DialogContent>
		</Dialog>
	);
}

function TurnFileRestoreContent({
	sessionId,
	restoring,
	setRestoring,
}: {
	sessionId: string;
	restoring: boolean;
	setRestoring: (restoring: boolean) => void;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const [turns, setTurns] = useState<readonly TurnFilesSummary[] | null>(null);
	const [selected, setSelected] = useState<TurnFilesSummary | null>(null);
	const [preview, setPreview] = useState<TurnFileRestorePreview | null>(null);
	const [result, setResult] = useState<readonly TurnFileRestoreEntry[] | null>(null);
	const [error, setError] = useState(false);
	const [attempt, setAttempt] = useState(0);
	useEffect(() => {
		let current = true;
		void waitForCommittedPaint().then(async () => {
			if (!current) return;
			try {
				if (selected) {
					const value = await window.agent567.session.previewTurnFiles(sessionId, selected.turnId);
					if (current) setPreview(value);
				} else {
					const value = await window.agent567.session.listTurnFiles(sessionId);
					if (current) setTurns(value);
				}
			} catch {
				if (current) setError(true);
			}
		});
		return () => {
			current = false;
		};
	}, [sessionId, selected, attempt]);
	const select = (turn: TurnFilesSummary | null) => {
		setSelected(turn);
		setPreview(null);
		setResult(null);
		setError(false);
	};
	const restore = async () => {
		if (!preview || restoring) return;
		setRestoring(true);
		setError(false);
		try {
			setResult(await window.agent567.session.restoreTurnFiles(sessionId, preview.previewId));
		} catch {
			setError(true);
		} finally {
			setPreview(null);
			setRestoring(false);
		}
	};
	const files = result ?? preview?.files;
	const readyCount = preview?.files.filter((file) => file.status === "ready").length ?? 0;
	const loading = !error && (selected ? !files : !turns);
	return (
		<>
			{selected && (
				<div className="flex min-w-0 items-center gap-2">
					<Button variant="ghost" size="sm" disabled={restoring} onClick={() => select(null)}>
						{t("workbench.backToList")}
					</Button>
					<p className="min-w-0 truncate text-[13px] font-medium">
						{selected.title || new Date(selected.timestamp).toLocaleString()}
					</p>
				</div>
			)}
			{error && (
				<div className="space-y-2">
					<p role="alert" className="text-[13px] text-destructive">
						{t("workbench.turnFiles.error")}
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setError(false);
							setAttempt((value) => value + 1);
						}}
					>
						{t("workbench.refresh")}
					</Button>
				</div>
			)}
			{loading && (
				<p role="status" className="text-[13px] text-muted-foreground">
					{t("workbench.loading")}
				</p>
			)}
			{!selected && turns?.length === 0 && !error && (
				<p className="text-[13px] text-muted-foreground">{t("workbench.turnFiles.empty")}</p>
			)}
			{!selected && Boolean(turns?.length) && (
				<ul className="min-h-0 divide-y divide-border/50 overflow-y-auto">
					{turns?.map((turn) => (
						<li key={turn.turnId}>
							<Button
								variant="ghost"
								className="h-auto w-full min-w-0 justify-between px-3 py-2.5 text-left"
								onClick={() => select(turn)}
							>
								<span className="min-w-0 truncate">
									{turn.title || new Date(turn.timestamp).toLocaleString()}
								</span>
								<span className="shrink-0 text-[11px] text-muted-foreground">
									{t("workbench.itemCount", { count: turn.fileCount })}
								</span>
							</Button>
						</li>
					))}
				</ul>
			)}
			{selected && files && (
				<ul className="min-h-0 divide-y divide-border/50 overflow-y-auto">
					{files.map((file) => (
						<li key={file.path} className="flex items-start gap-2 px-3 py-2.5 text-[13px]">
							<span className="min-w-0 flex-1 break-all">{file.path}</span>
							<span className="shrink-0 text-[11px] text-muted-foreground">
								{t(`workbench.turnFiles.change.${file.change}`)}
							</span>
							<span
								className={`shrink-0 text-[11px] ${file.status === "conflict" ? "text-destructive" : "text-foreground"}`}
							>
								{t(`workbench.turnFiles.status.${file.status}`)}
							</span>
						</li>
					))}
				</ul>
			)}
			{result && (
				<p role="status" className="text-[13px] text-muted-foreground">
					{t("workbench.turnFiles.result")}
				</p>
			)}
			{readyCount > 0 && (
				<div className="flex shrink-0 justify-end border-t border-border pt-3">
					<Button variant="destructive" disabled={restoring} onClick={() => void restore()}>
						{restoring
							? t("workbench.turnFiles.restoring")
							: t("workbench.turnFiles.confirm", { count: readyCount })}
					</Button>
				</div>
			)}
		</>
	);
}
