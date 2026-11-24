import { useState, type JSX } from "react";
import type { SidebarNavItem } from "@vetta-org/theme-sdk/sidebar";
import { cn } from "@vetta-org/ui";
import { SidebarNavBadgeView } from "./SidebarNavBadgeView";
import type { SidebarNavDragHandlers, SidebarNavRegion } from "./useSidebarNavDrag";
import { SidebarNavIcon } from "./SidebarNavIcon";

export interface SidebarNavMorePanelLabels {
	/** 置顶区分组标题。 */
	pinnedTitle: string;
	/** 收纳区分组标题。 */
	moreTitle: string;
	pin: string;
	unpin: string;
	/** 置顶区已满时 pin 按钮的 title。 */
	pinFull: string;
	reset: string;
	/** 从普通态进入编辑态的按钮文案（未传时回落 pinnedTitle）。 */
	edit?: string;
	/** 从编辑态退回普通态的按钮文案。 */
	done?: string;
}

export interface SidebarNavMorePanelProps {
	canPinMore: boolean;
	drag: SidebarNavDragHandlers & { draggingKey: string | null };
	editing?: boolean;
	labels: SidebarNavMorePanelLabels;
	moreItems: readonly SidebarNavItem[];
	onEditingChange?: (editing: boolean) => void;
	onItemClick: (item: SidebarNavItem) => void;
	onItemIntent?: (item: SidebarNavItem) => void;
	onPin: (key: string) => void;
	onReset: () => void;
	onUnpin: (key: string) => void;
	pinnedItems: readonly SidebarNavItem[];
}

function DropLine({ visible }: { visible: boolean }): JSX.Element {
	return (
		<span aria-hidden className={cn("mx-1 block h-px rounded-full", visible ? "bg-primary" : "bg-transparent")} />
	);
}

// 行内不加任何 transition：弹层里 20+ 行，每行的 hover 过渡（尤其 pin 按钮的 opacity）
// 会在指针划过时反复创建合成层动画，实测 hover 帧间隔从 14ms 劣化到 p95 70ms。
function NavRow({
	drag,
	item,
	labels,
	onClick,
	onIntent,
	onTogglePin,
	pinDisabled,
	region,
}: {
	drag: SidebarNavMorePanelProps["drag"];
	item: SidebarNavItem;
	labels: SidebarNavMorePanelLabels;
	onClick: () => void;
	onIntent?: () => void;
	onTogglePin: (() => void) | null;
	pinDisabled: boolean;
	region: SidebarNavRegion;
}): JSX.Element {
	const dragProps = drag.itemProps(item, region);
	const pinned = region === "pinned";
	return (
		<div
			className={cn(
				"group/nav-row flex items-center gap-1 rounded-md pr-1",
				drag.draggingKey === item.key && "opacity-40",
			)}
			draggable={dragProps.draggable}
			onDragStart={dragProps.onDragStart}
			onDragEnd={dragProps.onDragEnd}
			onDragOver={dragProps.onDragOver}
			onDrop={dragProps.onDrop}
		>
			<span
				aria-hidden
				className={cn(
					"icon-[solar--hamburger-menu-linear] h-3.5 w-3.5 shrink-0 text-muted-foreground/40",
					dragProps.draggable ? "cursor-grab" : "opacity-0",
				)}
			/>
			<button
				type="button"
				title={item.title ?? item.label}
				onClick={onClick}
				onFocus={onIntent}
				onMouseEnter={onIntent}
				className={cn(
					"flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1.5 text-[13px]",
					item.active ? "bg-accent font-semibold text-foreground" : "text-foreground hover:bg-accent/50",
				)}
			>
				<SidebarNavIcon icon={item.icon} iconUrl={item.iconUrl} />
				<span className="truncate">{item.label}</span>
				{item.badge && <SidebarNavBadgeView badge={item.badge} />}
			</button>
			{onTogglePin ? (
				<button
					type="button"
					disabled={pinDisabled}
					title={pinned ? labels.unpin : pinDisabled ? labels.pinFull : labels.pin}
					aria-label={pinned ? labels.unpin : labels.pin}
					aria-pressed={pinned}
					onClick={onTogglePin}
					className={cn(
						"flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
						pinned
							? "text-primary hover:bg-accent/60"
							: "text-muted-foreground/60 opacity-60 hover:bg-accent/60 hover:text-foreground focus-visible:opacity-100 group-hover/nav-row:opacity-100",
						pinDisabled && "cursor-not-allowed opacity-30 group-hover/nav-row:opacity-30",
					)}
				>
					<span className={cn(pinned ? "icon-[solar--pin-bold]" : "icon-[solar--pin-linear]", "h-3.5 w-3.5")} />
				</button>
			) : (
				// 锁定项（「新会话」）没有 pin 动作，占位保持行对齐。
				<span aria-hidden className="h-6 w-6 shrink-0" />
			)}
		</div>
	);
}

/**
 * 「更多」弹层：默认展示干净的次要入口跳转列表；点「自定义」进入编辑态后，
 * 再展示置顶区、拖拽手柄、pin 开关与恢复默认。
 */
export function SidebarNavMorePanel({
	canPinMore,
	drag,
	editing: controlledEditing,
	labels,
	moreItems,
	onEditingChange,
	onItemClick,
	onItemIntent,
	onPin,
	onReset,
	onUnpin,
	pinnedItems,
}: SidebarNavMorePanelProps): JSX.Element {
	const [uncontrolledEditing, setUncontrolledEditing] = useState(false);
	const editing = controlledEditing ?? uncontrolledEditing;
	const setEditing = onEditingChange ?? setUncontrolledEditing;
	// 收纳区为空时没有可跳转的次要项，直接展示编辑态避免弹出空列表。
	const showEditor = editing || moreItems.length === 0;

	if (!showEditor) {
		return (
			<div className="flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto">
				{moreItems.map((item) => (
					<button
						key={item.key}
						type="button"
						title={item.title ?? item.label}
						onClick={() => onItemClick(item)}
						onFocus={() => onItemIntent?.(item)}
						onMouseEnter={() => onItemIntent?.(item)}
						className={cn(
							"flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]",
							item.active
								? "bg-accent font-semibold text-foreground"
								: "text-foreground hover:bg-accent/50",
						)}
					>
						<SidebarNavIcon icon={item.icon} iconUrl={item.iconUrl} />
						<span className="truncate">{item.label}</span>
						{item.badge && <SidebarNavBadgeView badge={item.badge} />}
					</button>
				))}
				<div className="mt-0.5 border-t border-border/60 pt-0.5">
					<button
						type="button"
						onClick={() => setEditing(true)}
						className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] text-muted-foreground hover:bg-accent/50 hover:text-foreground"
					>
						<span aria-hidden className="icon-[solar--tuning-2-linear] h-3.5 w-3.5 shrink-0" />
						<span className="truncate">{labels.edit ?? labels.pinnedTitle}</span>
					</button>
				</div>
			</div>
		);
	}

	const pinnedRegion = drag.regionProps("pinned");
	const moreRegion = drag.regionProps("more");
	const hasLockedTail = moreItems[moreItems.length - 1]?.locked === true;
	// 固定入口仍在侧栏顶部显示；自定义面板只列出可以调整的置顶项。
	const visiblePinnedItems = pinnedItems.filter((item) => item.locked !== true);

	return (
		<div className="flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
			<div className="flex items-center gap-1 px-2 pt-1">
				<p className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
					{labels.pinnedTitle}
				</p>
				<button
					type="button"
					onClick={onReset}
					title={labels.reset}
					aria-label={labels.reset}
					className="-me-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-accent/50 hover:text-foreground"
				>
					<span aria-hidden className="icon-[solar--restart-linear] h-3.5 w-3.5" />
				</button>
				{moreItems.length > 0 && (
					<button
						type="button"
						onClick={() => setEditing(false)}
						className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-accent/60"
					>
						{labels.done ?? "OK"}
					</button>
				)}
			</div>
			<div
				className={cn("flex flex-col", visiblePinnedItems.length === 0 && "min-h-6")}
				onDragOver={pinnedRegion.onDragOver}
				onDrop={pinnedRegion.onDrop}
			>
				{visiblePinnedItems.map((item) => (
					<div key={item.key}>
						<DropLine visible={drag.isDropBefore(item.key, "pinned")} />
						<NavRow
							drag={drag}
							item={item}
							labels={labels}
							onClick={() => onItemClick(item)}
							onIntent={onItemIntent ? () => onItemIntent(item) : undefined}
							onTogglePin={item.locked === true ? null : () => onUnpin(item.key)}
							pinDisabled={false}
							region="pinned"
						/>
					</div>
				))}
				<DropLine visible={drag.isDropAtEnd("pinned")} />
			</div>

			{moreItems.length > 0 && (
				<p className="px-2 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
					{labels.moreTitle}
				</p>
			)}
			<div
				className={cn("flex flex-col", moreItems.length === 0 && "min-h-4")}
				onDragOver={moreRegion.onDragOver}
				onDrop={moreRegion.onDrop}
			>
				{moreItems.map((item, index) => {
					// 末位锁定项（「更多选项」）之后没有落位，「落到末尾」的指示线要画在它**之前**。
					const lockedTail = item.locked === true && index === moreItems.length - 1;
					return (
						<div key={item.key}>
							<DropLine
								visible={drag.isDropBefore(item.key, "more") || (lockedTail && drag.isDropAtEnd("more"))}
							/>
							<NavRow
								drag={drag}
								item={item}
								labels={labels}
								onClick={() => onItemClick(item)}
								onIntent={onItemIntent ? () => onItemIntent(item) : undefined}
								onTogglePin={item.locked === true ? null : () => onPin(item.key)}
								pinDisabled={!canPinMore}
								region="more"
							/>
						</div>
					);
				})}
				<DropLine visible={!hasLockedTail && drag.isDropAtEnd("more")} />
			</div>
		</div>
	);
}
