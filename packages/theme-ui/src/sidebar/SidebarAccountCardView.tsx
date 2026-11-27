import { Button, DropdownMenuItem, cn } from "@vetta-org/ui";
import type { JSX, ReactNode } from "react";

export interface SidebarAccountCardViewProps {
	readonly avatar: ReactNode;
	readonly name: string;
	readonly subtitle?: string;
	readonly signedIn: boolean;
	readonly cardLabel: string;
	readonly balanceLabel?: string;
	readonly balanceValue?: string;
	readonly spendLabel?: string;
	readonly spendValue?: string;
	readonly spendDetail?: string;
	readonly statusText?: string;
	readonly loading?: boolean;
	readonly canRefresh?: boolean;
	readonly refreshLabel?: string;
	readonly onRefresh?: () => void;
	readonly signedOutHint?: string;
}

/**
 * Pure presentational account summary card rendered at the top of the sidebar account menu.
 */
export function SidebarAccountCardView({
	avatar,
	name,
	subtitle,
	signedIn,
	cardLabel,
	balanceLabel,
	balanceValue,
	spendLabel,
	spendValue,
	spendDetail,
	statusText,
	loading = false,
	canRefresh = false,
	refreshLabel,
	onRefresh,
	signedOutHint,
}: SidebarAccountCardViewProps): JSX.Element {
	const handleRefreshSelect = (event: Event) => {
		event.preventDefault();
		onRefresh?.();
	};

	return (
		<section
			aria-label={cardLabel}
			aria-busy={loading}
			className="rounded-xl border border-border/60 bg-muted/35 p-3"
		>
			<div className="flex items-center gap-2.5">
				{avatar}
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] font-semibold leading-4 text-foreground" title={name}>
						{name}
					</div>
					{subtitle && (
						<div className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground" title={subtitle}>
							{subtitle}
						</div>
					)}
				</div>
				{signedIn && onRefresh && refreshLabel && (
					<DropdownMenuItem asChild disabled={!canRefresh} onSelect={handleRefreshSelect}>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							className="h-7 w-7 shrink-0 rounded-lg p-0 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
							aria-label={refreshLabel}
							title={refreshLabel}
						>
							<span
								aria-hidden="true"
								className={cn("icon-[solar--refresh-linear] h-3.5 w-3.5", loading && "animate-spin")}
							/>
						</Button>
					</DropdownMenuItem>
				)}
			</div>

			{signedIn ? (
				<>
					<div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-border/50 pt-2.5">
						<div className="min-w-0">
							<div className="text-[11px] leading-4 text-muted-foreground">{balanceLabel}</div>
							<div
								className="mt-0.5 truncate font-mono text-[15px] font-semibold leading-5 text-foreground tabular-nums"
								title={balanceValue}
							>
								{balanceValue}
							</div>
						</div>
						<div className="min-w-0 border-l border-border/50 pl-3">
							<div className="text-[11px] leading-4 text-muted-foreground">{spendLabel}</div>
							<div
								className="mt-0.5 truncate font-mono text-[15px] font-semibold leading-5 text-foreground tabular-nums"
								title={spendValue ?? "—"}
							>
								{spendValue ?? "—"}
							</div>
							{spendDetail && (
								<div
									className="mt-0.5 truncate font-mono text-[10px] leading-3.5 text-muted-foreground tabular-nums"
									title={spendDetail}
								>
									{spendDetail}
								</div>
							)}
						</div>
					</div>
					{statusText && (
						<p role="status" className="mt-2.5 border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground">
							{statusText}
						</p>
					)}
				</>
			) : (
				signedOutHint && (
					<p className="mt-2.5 border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground">
						{signedOutHint}
					</p>
				)
			)}
		</section>
	);
}
