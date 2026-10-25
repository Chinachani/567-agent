import { cn } from "@vetta-org/ui";
import type { JSX, ReactNode, Ref } from "react";
import { RunningPulseDot } from "../sidebar/RunningPulseDot";
import { PROJECT_TYPE_ICONS, type ProjectTypeIconKey } from "./types";

export interface ProjectRowViewProps {
	badge?: string;
	displayName: string;
	expanded: boolean;
	hasRunning: boolean;
	isActive: boolean;
	newSessionTitle: string;
	contextMenuTitle?: string;
	onCollapse: () => void;
	onExpand: () => void;
	onInteract?: () => void;
	onNavigateProject: () => void;
	onNewSession: () => void;
	onOpenContextMenu: (event: React.MouseEvent) => void;
	projectCwd: string;
	projectType: ProjectTypeIconKey;
	trailingAction?: ReactNode;
	rowRef?: Ref<HTMLDivElement>;
}

export function ProjectRowView({
	badge,
	displayName,
	expanded,
	hasRunning,
	isActive,
	newSessionTitle,
	contextMenuTitle,
	onCollapse,
	onExpand,
	onInteract,
	onNavigateProject,
	onNewSession,
	onOpenContextMenu,
	projectCwd,
	projectType,
	trailingAction,
	rowRef,
}: ProjectRowViewProps): JSX.Element {
	return (
		<div
			ref={rowRef}
			className={cn(
				"group flex w-full items-center gap-2 rounded-lg px-2.5 py-[6px] text-left transition-colors duration-100",
				isActive ? "bg-accent text-foreground" : "hover:bg-accent/50",
			)}
			title={projectCwd}
			onContextMenu={onOpenContextMenu}
		>
			<button
				type="button"
				onClick={() => {
					onInteract?.();
					if (expanded) {
						onCollapse();
						return;
					}
					onExpand();
					onNavigateProject();
				}}
				className="relative flex shrink-0 items-center justify-center"
			>
				<span
					className={cn(
						expanded ? "icon-[solar--alt-arrow-down-linear]" : PROJECT_TYPE_ICONS[projectType],
						"h-4 w-4",
						isActive ? "text-foreground" : "text-muted-foreground",
					)}
				/>
				{hasRunning && <RunningPulseDot />}
			</button>
			<button
				type="button"
				onClick={() => {
					onInteract?.();
					if (!expanded) {
						onExpand();
					}
					onNavigateProject();
				}}
				className={cn(
					"min-w-0 flex-1 truncate text-left text-[13px] font-medium",
					isActive ? "font-semibold text-foreground" : "text-foreground",
				)}
			>
				{displayName}
			</button>
			<div className="relative flex shrink-0 items-center gap-1">
				{contextMenuTitle && (
					<button
						type="button"
						title={contextMenuTitle}
						aria-label={contextMenuTitle}
						className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						onClick={(event) => {
							event.stopPropagation();
							onOpenContextMenu(event);
						}}
					>
						<span aria-hidden="true" className="icon-[solar--menu-dots-linear] h-3.5 w-3.5" />
					</button>
				)}
				{trailingAction}
				{badge && (
					<span className="rounded-sm bg-accent px-1 py-px text-[10px] text-muted-foreground group-hover:hidden">
						{badge}
					</span>
				)}
				<button
					type="button"
					title={newSessionTitle}
					onClick={(event) => {
						event.stopPropagation();
						onNewSession();
					}}
					className={cn(
						"flex h-[18px] w-[18px] items-center justify-center rounded-[4px] text-foreground hover:bg-accent",
						badge ? "hidden group-hover:flex" : "opacity-0 group-hover:opacity-100",
					)}
				>
					<span className="icon-[solar--add-circle-linear] h-3 w-3" />
				</button>
			</div>
		</div>
	);
}
