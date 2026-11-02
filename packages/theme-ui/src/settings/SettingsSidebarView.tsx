import type { JSX } from "react";
import { cn } from "@vetta-org/ui";

export interface SettingsSidebarTabItem {
	readonly beta?: boolean;
	readonly icon: string;
	readonly iconUrl?: string;
	readonly key: string;
	readonly label: string;
	readonly title?: string;
	readonly separatorBefore?: boolean;
}

export interface SettingsSidebarViewProps {
	readonly activeTab: string;
	readonly betaBadgeLabel: string;
	readonly narrow: boolean;
	readonly onSelectTab: (tab: string) => void;
	readonly onTabIntent?: (tab: string) => void;
	readonly tabs: readonly SettingsSidebarTabItem[];
	readonly title: string;
}

export function SettingsSidebarView({
	activeTab,
	betaBadgeLabel,
	narrow,
	onSelectTab,
	onTabIntent,
	tabs,
	title,
}: SettingsSidebarViewProps): JSX.Element {
	return (
		<div
			className={cn(
				"flex min-h-0 shrink-0 flex-col border-r border-border/60 bg-muted/20",
				narrow ? "w-14" : "w-[200px]",
			)}
		>
			<div className={cn("drag-region", narrow ? "h-12" : "px-5 pb-5 pt-5")}>
				{!narrow && <h1 className="text-[15px] font-semibold text-foreground">{title}</h1>}
			</div>
			<nav
				aria-label={title}
				className={cn("flex min-h-0 flex-col gap-1 overflow-y-auto pb-6", narrow ? "px-2" : "px-2.5")}
			>
				{tabs.map((item) => (
					<div key={item.key} className={cn(item.separatorBefore && "mt-2 border-t border-border/60 pt-2")}>
						<button
							type="button"
							aria-label={item.label}
							title={item.title ?? item.label}
							aria-current={activeTab === item.key ? "page" : undefined}
							onClick={() => onSelectTab(item.key)}
							onFocus={() => onTabIntent?.(item.key)}
							onMouseEnter={() => onTabIntent?.(item.key)}
							className={cn(
								"flex w-full min-w-0 items-center rounded-lg text-[13px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
								narrow ? "justify-center px-0 py-2" : "gap-2.5 px-2.5 py-[7px]",
								activeTab === item.key
									? "bg-accent/80 text-foreground"
									: "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
							)}
						>
							{item.iconUrl ? (
								<img src={item.iconUrl} alt="" className="h-4 w-4 shrink-0 object-contain" />
							) : (
								<span aria-hidden="true" className={cn(item.icon, "h-4 w-4 shrink-0")} />
							)}
							{!narrow && <span className="flex-1 truncate text-left">{item.label}</span>}
							{!narrow && item.beta && (
								<span className="rounded-full border border-primary/40 px-1.5 py-px text-[9px] font-semibold uppercase leading-tight tracking-wide text-primary">
									{betaBadgeLabel}
								</span>
							)}
						</button>
					</div>
				))}
			</nav>
		</div>
	);
}
