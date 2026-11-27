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
import { openSessionFnRef } from "@shared/store/atoms";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	ManagedWorktreeActionResult,
	ManagedWorktreeErrorCode,
	ManagedWorktreeInfo,
	ProjectCollaborationWorktreesState,
} from "@/shared/project-collaboration";

export function ManagedWorktreesDialog({ cwd }: { cwd: string }): JSX.Element {
	const { t } = useTranslation("project");
	const navigate = useNavigate();
	const [open, setOpen] = useState(false);
	const [working, setWorking] = useState(false);
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!working) setOpen(next);
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm" className="shrink-0 self-start">
					<span className="icon-[solar--branching-paths-up-linear] h-3.5 w-3.5" aria-hidden="true" />
					{t("worktrees.title")}
				</Button>
			</DialogTrigger>
			<DialogContent className="flex max-h-[80dvh] min-w-0 flex-col overflow-hidden">
				<DialogHeader>
					<DialogTitle>{t("worktrees.title")}</DialogTitle>
					<DialogDescription>{t("worktrees.hint")}</DialogDescription>
				</DialogHeader>
				{open && (
					<ManagedWorktreesContent
						cwd={cwd}
						working={working}
						setWorking={setWorking}
						openHistory={(path) => {
							setOpen(false);
							void navigate({ to: "/viewer/$path", params: { path: encodeURIComponent(path) } });
						}}
						close={() => setOpen(false)}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function ManagedWorktreesContent({
	cwd,
	working,
	setWorking,
	openHistory,
	close,
}: {
	cwd: string;
	working: boolean;
	setWorking: (working: boolean) => void;
	openHistory: (path: string) => void;
	close: () => void;
}): JSX.Element {
	const { t } = useTranslation("project");
	const [snapshot, setSnapshot] = useState<ProjectCollaborationWorktreesState | null>(null);
	const [confirm, setConfirm] = useState<ManagedWorktreeInfo | null>(null);
	const [error, setError] = useState<ManagedWorktreeErrorCode | "read" | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [changedPaths, setChangedPaths] = useState<readonly string[]>([]);
	useEffect(() => {
		let active = true;
		async function read() {
			try {
				const current = await window.agent567.project.readWorktrees(cwd);
				if (active) setSnapshot(current);
			} catch {
				if (active) setError("read");
			}
		}
		void waitForCommittedPaint().then(() => {
			if (active) void read();
		});
		return () => {
			active = false;
		};
	}, [cwd, attempt]);

	const execute = async (action: () => Promise<ManagedWorktreeActionResult>) => {
		if (working) return;
		setWorking(true);
		setError(null);
		setChangedPaths([]);
		try {
			const result = await action();
			if (result.ok) setSnapshot(result.snapshot);
			else {
				setError(result.error.code);
				setChangedPaths(result.error.changedPreview ?? []);
			}
		} catch {
			setError("git-failed");
		} finally {
			setConfirm(null);
			setWorking(false);
		}
	};
	const list = snapshot?.worktrees ?? [];
	return (
		<>
			{!snapshot && !error && (
				<p role="status" className="text-[13px] text-muted-foreground">
					{t("worktrees.loading")}
				</p>
			)}
			{error && (
				<div className="space-y-2">
					<p role="alert" className="text-[13px] text-destructive">
						{t(`worktrees.error.${error}`)}
					</p>
					{changedPaths.length > 0 && (
						<ul className="max-h-24 overflow-y-auto text-[12px] text-muted-foreground">
							{changedPaths.map((path) => (
								<li key={path} className="break-all">
									{path}
								</li>
							))}
						</ul>
					)}
				</div>
			)}
			{snapshot && !snapshot.supported && (
				<p className="text-[13px] text-muted-foreground">{t("worktrees.unsupported")}</p>
			)}
			{snapshot && (snapshot.supported || list.length > 0) && (
				<>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="primary"
							size="sm"
							disabled={working || !snapshot.supported}
							onClick={() => void execute(() => window.agent567.project.createWorktree(cwd))}
						>
							{t(working && !confirm ? "worktrees.creating" : "worktrees.create")}
						</Button>
					</div>
					{list.length === 0 && <p className="text-[13px] text-muted-foreground">{t("worktrees.empty")}</p>}
					<ul className="min-h-0 divide-y divide-border/50 overflow-y-auto">
						{list.map((tree) => (
							<li key={tree.path} className="space-y-2 px-3 py-2.5 text-[13px]">
								<p className="break-all font-medium">{tree.cwd}</p>
								<p className="text-[12px] text-muted-foreground">
									{t(
										`worktrees.state.${tree.state === "missing" ? "missing" : tree.inUse ? "inUse" : tree.dirty === null ? "unavailable" : tree.dirty ? "dirty" : "ready"}`,
									)}
								</p>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										variant="ghost"
										size="sm"
										disabled={working}
										onClick={() => {
											if (tree.state === "missing") openHistory(tree.sessionPath);
											else {
												close();
												void openSessionFnRef.current?.(cwd, tree.sessionPath);
											}
										}}
									>
										{t(tree.state === "missing" ? "worktrees.openHistory" : "collaboration.openSession")}
									</Button>
									<Button
										variant="outline"
										size="sm"
										disabled={working || tree.inUse || tree.dirty !== false}
										onClick={() => setConfirm(tree)}
									>
										{t("worktrees.remove")}
									</Button>
								</div>
							</li>
						))}
					</ul>
				</>
			)}
			{(snapshot || error) && (
				<Button
					className="self-start"
					variant="ghost"
					size="sm"
					disabled={working}
					onClick={() => {
						setError(null);
						setChangedPaths([]);
						setAttempt((value) => value + 1);
					}}
				>
					{t("worktrees.refresh")}
				</Button>
			)}
			<Dialog
				open={confirm !== null}
				onOpenChange={(open) => {
					if (!open && !working) setConfirm(null);
				}}
			>
				<DialogContent>
					<DialogTitle>{t("worktrees.remove")}</DialogTitle>
					<DialogDescription>{t("worktrees.removeHint")}</DialogDescription>
					<div className="flex justify-end gap-2">
						<Button variant="ghost" disabled={working} onClick={() => setConfirm(null)}>
							{t("worktrees.cancel")}
						</Button>
						<Button
							variant="destructive"
							disabled={working}
							onClick={() => {
								if (confirm) void execute(() => window.agent567.project.removeWorktree(cwd, confirm.path));
							}}
						>
							{t("worktrees.remove")}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
