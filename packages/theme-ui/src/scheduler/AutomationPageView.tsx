import type { JSX, ReactNode } from "react";
import { motion } from "motion/react";
import { Button } from "@vetta-org/ui";
import { WorkspacePageHeader } from "../shared/WorkspacePageHeader";

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface AutomationRecommendationItem {
	readonly id: string;
	readonly icon: string;
	readonly title: string;
	readonly description: string;
	readonly scheduleLabel: string;
}

export interface AutomationPageViewLabels {
	readonly title: string;
	readonly subtitle: string;
	readonly newTask: string;
	readonly newTaskTitle: string;
	/** @deprecated Empty hero removed; kept optional for host compatibility. */
	readonly emptyTitle?: string;
	readonly emptyDesc?: string;
	readonly emptyAction?: string;
	/** Section heading above recommended templates when the user has no tasks. */
	readonly recommendTitle?: string;
	/** Optional CTA on each recommendation card. */
	readonly recommendUse?: string;
}

export interface AutomationPageViewProps {
	readonly hasTasks: boolean;
	/** Optional trailing header actions (e.g. AI assist), rendered before the primary CTA. */
	readonly headerTrailing?: ReactNode;
	readonly labels: AutomationPageViewLabels;
	readonly onNewTask: () => void;
	/** Host-owned TaskList / empty handled here when hasTasks. */
	readonly taskList: ReactNode;
	readonly historyDrawer: ReactNode;
	readonly taskFormDialog: ReactNode;
	/** Recommended templates shown only when `hasTasks` is false. */
	readonly recommendations?: readonly AutomationRecommendationItem[];
	readonly onSelectRecommendation?: (id: string) => void;
}

export function AutomationPageView({
	hasTasks,
	headerTrailing,
	labels,
	onNewTask,
	taskList,
	historyDrawer,
	taskFormDialog,
	recommendations,
	onSelectRecommendation,
}: AutomationPageViewProps): JSX.Element {
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
							<Button type="button" variant="primary" onClick={onNewTask} title={labels.newTaskTitle}>
								<span className="icon-[solar--add-circle-linear] h-4 w-4" />
								{labels.newTask}
							</Button>
						</>
					}
				/>
			</div>

			<div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6 sm:px-8">
				<div className="mx-auto w-full max-w-6xl">
					{hasTasks ? (
						taskList
					) : (
						<AutomationRecommendations
							recommendTitle={labels.recommendTitle}
							recommendUse={labels.recommendUse}
							recommendations={recommendations}
							onSelectRecommendation={onSelectRecommendation}
						/>
					)}
				</div>
			</div>

			{historyDrawer}
			{taskFormDialog}
		</div>
	);
}

function AutomationRecommendations({
	recommendTitle,
	recommendUse,
	recommendations,
	onSelectRecommendation,
}: {
	readonly recommendTitle?: string;
	readonly recommendUse?: string;
	readonly recommendations?: readonly AutomationRecommendationItem[];
	readonly onSelectRecommendation?: (id: string) => void;
}): JSX.Element | null {
	if (!recommendations || recommendations.length === 0) return null;

	return (
		<motion.div
			className="flex w-full flex-col gap-3"
			initial={{ opacity: 0, y: 12 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.5, ease: easeOut }}
		>
			{recommendTitle ? (
				<p className="text-[12px] font-medium tracking-wide text-muted-foreground">{recommendTitle}</p>
			) : null}
			<div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-3">
				{recommendations.map((item) => (
					<Button
						variant="ghost"
						key={item.id}
						type="button"
						onClick={() => onSelectRecommendation?.(item.id)}
						className="group flex h-auto min-w-0 flex-col items-stretch whitespace-normal rounded-xl border border-border/70 bg-card/50 p-5 text-left transition-colors hover:border-primary/30 hover:bg-accent/40"
					>
						<div className="flex items-start gap-3">
							<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/15">
								<span className={`${item.icon} h-4 w-4 text-primary`} />
							</div>
							<div className="min-w-0 flex-1">
								<p className="break-words text-[14px] font-semibold text-foreground">{item.title}</p>
								<p className="mt-0.5 truncate text-[11px] text-muted-foreground">{item.scheduleLabel}</p>
							</div>
						</div>
						<p className="mt-3 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
							{item.description}
						</p>
						{recommendUse && (
							<span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary opacity-80 transition-opacity group-hover:opacity-100">
								{recommendUse}
								<span className="icon-[solar--arrow-right-linear] h-3.5 w-3.5" />
							</span>
						)}
					</Button>
				))}
			</div>
		</motion.div>
	);
}
