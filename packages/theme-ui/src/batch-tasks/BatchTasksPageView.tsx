import { Button } from "@vetta-org/ui";
import { WorkspacePageHeader } from "../shared/WorkspacePageHeader";
import { motion } from "motion/react";
import type { JSX, ReactNode } from "react";
import type { BatchTasksPageLabels, BatchTasksPageStatsView } from "./types";

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface BatchTasksPageViewProps {
	/** Dialog host node (BatchProjectDialog). */
	dialog: ReactNode;
	/** Optional trailing header actions (e.g. AI assist), rendered before the primary CTA. */
	headerTrailing?: ReactNode;
	labels: BatchTasksPageLabels;
	/** Task list when projects exist; ignored when empty. */
	list: ReactNode;
	onNewProject: () => void;
	projectCount: number;
	stats: BatchTasksPageStatsView;
}

export function BatchTasksPageView({
	dialog,
	headerTrailing,
	labels,
	list,
	onNewProject,
	projectCount,
	stats,
}: BatchTasksPageViewProps): JSX.Element {
	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<div className="shrink-0 px-5 pt-6 sm:px-8">
				<WorkspacePageHeader
					title={labels.title}
					description={labels.subtitle}
					className="mx-auto w-full max-w-6xl border-b border-border/60 pb-6"
					actions={
						<>
							{headerTrailing}
							<Button variant="primary" onClick={onNewProject}>
								<span className="icon-[solar--add-circle-linear] h-4 w-4" />
								{labels.newProject}
							</Button>
						</>
					}
				/>
				{stats.total > 0 && (
					<div className="mx-auto w-full max-w-6xl pt-4">
						<CompactStats labels={labels} stats={stats} />
					</div>
				)}
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-6 sm:px-8">
				<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col">
					{projectCount === 0 ? <EmptyState labels={labels} onNew={onNewProject} /> : list}
				</div>
			</div>

			{dialog}
		</div>
	);
}

function CompactStats({
	labels,
	stats,
}: {
	labels: BatchTasksPageLabels;
	stats: BatchTasksPageStatsView;
}): JSX.Element {
	const items: { label: string; value: number; tone: string }[] = [
		{ label: labels.statsTotal, value: stats.total, tone: "text-muted-foreground" },
		{ label: labels.statsRunning, value: stats.running, tone: "text-foreground" },
		{ label: labels.statsCompleted, value: stats.completed, tone: "text-foreground" },
		{ label: labels.statsFailed, value: stats.failed, tone: "text-destructive" },
	];
	return (
		<motion.div
			initial={{ opacity: 0, y: -4 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.35, ease: easeOut, delay: 0.05 }}
			className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]"
		>
			{items.map((item, index) => (
				<div key={item.label} className="flex items-center gap-1.5">
					{index > 0 && <span className="h-3 w-px bg-border/50" />}
					<span className="text-muted-foreground">{item.label}</span>
					<span className={`tabular-nums text-[12px] font-semibold leading-none ${item.tone}`}>{item.value}</span>
				</div>
			))}
		</motion.div>
	);
}

function EmptyState({ labels, onNew }: { labels: BatchTasksPageLabels; onNew: () => void }): JSX.Element {
	return (
		<motion.div
			className="flex flex-1 flex-col items-center justify-center gap-5 text-center"
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.5, ease: easeOut }}
		>
			<div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-inset ring-primary/20">
				<span className="icon-[solar--list-check-linear] relative h-7 w-7 text-primary/80" />
			</div>
			<div className="space-y-1.5">
				<p className="text-[15px] font-semibold text-foreground">{labels.emptyTitle}</p>
				<p className="max-w-xs text-[12px] text-muted-foreground">{labels.emptyDesc}</p>
			</div>
			<Button variant="primary" onClick={onNew} className="mt-2">
				<span className="icon-[solar--add-circle-linear] h-4 w-4" />
				{labels.emptyAction}
			</Button>
		</motion.div>
	);
}
