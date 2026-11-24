import type { JSX } from "react";
import { cn } from "@vetta-org/ui";

export interface SettingsSidebarTabItem {
	readonly beta?: boolean;
	readonly icon: string;
	readonly iconUrl?: string;
	readonly key: string;
	readonly label: string;
	readonly title?: string;
	readonly sectionLabel?: string;
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
	const sections = new Map<string, SettingsSidebarTabItem[]>();
	for (const tab of tabs) {
		const key = tab.sectionLabel ?? "";
		const group = sections.get(key);
		if (group) group.push(tab);
		else sections.set(key, [tab]);
	}
	// Narrow workspaces retain the full category names without using a column of icons.
	if (narrow)
		return (
			<nav
				aria-label={title}
				className="settings-sidebar drag-region flex shrink-0 items-center gap-3 border-b border-border bg-muted/50 px-4 py-2"
			>
				<span className="truncate text-sm font-semibold">{title}</span>
				<select
					aria-label={title}
					value={tabs.some((tab) => tab.key === activeTab) ? activeTab : ""}
					onChange={(event) => onSelectTab(event.currentTarget.value)}
					className="no-drag ml-auto min-h-9 min-w-0 max-w-full rounded-lg border border-border bg-card px-2 text-sm text-card-foreground focus-visible:outline-ring"
				>
					<option value="" disabled hidden>
						{title}
					</option>
					{Array.from(sections, ([label, items]) => {
						const options = items.map((item) => (
							<option key={item.key} value={item.key}>
								{item.label}
								{item.beta ? ` · ${betaBadgeLabel}` : ""}
							</option>
						));
						return label ? (
							<optgroup key={label} label={label}>
								{options}
							</optgroup>
						) : (
							options
						);
					})}
				</select>
			</nav>
		);
	return (
		<div className="settings-sidebar flex min-h-0 w-[200px] shrink-0 flex-col overflow-hidden border-r border-border/60 bg-muted/50">
			<div className="drag-region shrink-0 px-5 pb-4 pt-6">
				<h1 className="text-[15px] font-semibold text-foreground">{title}</h1>
			</div>
			<nav aria-label={title} className="flex min-h-0 flex-col gap-1 overflow-y-auto px-2.5 pb-6">
				{tabs.map((item, index) => (
					<div key={item.key} className={cn(item.separatorBefore && "mt-2 border-t border-border/60 pt-2")}>
						{item.sectionLabel && tabs[index - 1]?.sectionLabel !== item.sectionLabel && (
							<h2 className="mb-1 mt-3 px-2.5 text-xs font-medium text-muted-foreground">{item.sectionLabel}</h2>
						)}
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
								"min-h-9 gap-2.5 px-2.5 py-2",
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
							<span className="flex-1 truncate text-left">{item.label}</span>
							{item.beta && (
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
