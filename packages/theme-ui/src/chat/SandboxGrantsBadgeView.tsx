import { Button, Popover, PopoverContent, PopoverTrigger } from "@vetta-org/ui";
import type { JSX } from "react";

export interface SandboxGrantViewItem {
	id: string;
	capabilityLabel: string;
	toolName: string;
	grantRoot: string;
	relativeTime: string;
	absoluteTime: string;
}

export interface SandboxGrantsBadgeViewLabels {
	tooltip: string;
	title: string;
	revokeAll: string;
	revoke: string;
}

export interface SandboxGrantsBadgeViewProps {
	count: number;
	open: boolean;
	grants: readonly SandboxGrantViewItem[];
	labels: SandboxGrantsBadgeViewLabels;
	pending?: boolean;
	error?: string;
	onOpenChange: (open: boolean) => void;
	onRevokeAll: () => void;
	onRevoke: (grantId: string) => void;
}

/**
 * Sandbox grants badge + dropdown panel. Host pre-resolves labels and relative times.
 */
export function SandboxGrantsBadgeView({
	count,
	open,
	grants,
	labels,
	pending = false,
	error,
	onOpenChange,
	onRevokeAll,
	onRevoke,
}: SandboxGrantsBadgeViewProps): JSX.Element {
	return (
		<Popover open={open} onOpenChange={onOpenChange}>
			<PopoverTrigger asChild>
				<button
					type="button"
					aria-label={labels.tooltip}
					title={labels.tooltip}
					className={`flex h-7 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 text-[11px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400 ${
						open ? "ring-1 ring-amber-500/40" : ""
					}`}
				>
					<span className="icon-[solar--shield-keyhole-minimalistic-linear] h-3.5 w-3.5" />
					<span>{count}</span>
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				aria-label={labels.title}
				collisionPadding={12}
				className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(360px,calc(100vw-24px))] flex-col gap-1 overflow-hidden p-2"
			>
				<div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-1.5">
					<div className="text-[12px] font-medium text-foreground">{labels.title}</div>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={pending}
						onClick={onRevokeAll}
						className="text-[11px]"
					>
						{labels.revokeAll}
					</Button>
				</div>
				{error ? (
					<p role="alert" className="px-2 pb-1 text-[11px] text-destructive">
						{error}
					</p>
				) : null}
				<div className="min-h-0 max-h-80 space-y-1 overflow-y-auto" aria-busy={pending}>
					{grants.map((grant) => (
						<div
							key={grant.id}
							className="flex items-start gap-2 rounded-md px-2 py-1.5 text-[11px] hover:bg-muted/50"
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-1.5">
									<span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
										{grant.toolName}·{grant.capabilityLabel}
									</span>
									<span title={grant.absoluteTime} className="text-[10px] text-muted-foreground/70">
										{grant.relativeTime}
									</span>
								</div>
								<div className="mt-0.5 truncate font-mono text-[11px] text-foreground" title={grant.grantRoot}>
									{grant.grantRoot}
								</div>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="xs"
								disabled={pending}
								onClick={() => onRevoke(grant.id)}
								className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
							>
								{labels.revoke}
							</Button>
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
