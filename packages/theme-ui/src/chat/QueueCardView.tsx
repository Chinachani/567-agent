import { Reorder, useDragControls } from "motion/react";
import type { JSX } from "react";
import { Button } from "@vetta-org/ui";

export interface QueueCardItem {
	id: string;
	displayText: string;
	kind?: "message" | "context_compaction";
	/** 压缩屏障之前的普通消息才允许跳过等待立即发送。 */
	canSendNow?: boolean;
}

export interface QueueCardViewLabels {
	empty: string;
	sendNow: string;
	delete: string;
}

/** abort/error 后队列暂停时的提示条：说明原因并提供「继续发送」入口。 */
export interface QueueCardPausedBanner {
	label: string;
	resumeLabel: string;
	onResume: () => void;
}

export interface QueueCardViewProps {
	items: readonly QueueCardItem[];
	labels: QueueCardViewLabels;
	onReorder: (orderedIds: readonly string[]) => void;
	onSendNow: (id: string) => void;
	onRemove: (id: string) => void;
	paused?: QueueCardPausedBanner;
}

export function QueueCardView({
	items,
	labels,
	onReorder,
	onSendNow,
	onRemove,
	paused,
}: QueueCardViewProps): JSX.Element {
	// Reorder.Group needs a mutable array of the same value identities.
	const reorderValues = items as QueueCardItem[];

	if (items.length === 0) {
		return (
			<div className="flex flex-1 items-center justify-center px-4 py-6 text-xs text-muted-foreground">
				{labels.empty}
			</div>
		);
	}

	return (
		<div className="flex flex-1 flex-col overflow-y-auto">
			{paused ? (
				<div className="flex items-center justify-between gap-2 border-b border-border/50 bg-amber-500/10 px-2.5 py-1.5">
					<span className="min-w-0 flex-1 truncate text-[11px] leading-snug text-amber-600 dark:text-amber-400">
						{paused.label}
					</span>
					<Button variant="secondary" size="xs" onClick={paused.onResume}>
						{paused.resumeLabel}
					</Button>
				</div>
			) : null}
			<Reorder.Group
				axis="y"
				values={reorderValues}
				onReorder={(next) => onReorder(next.map((item) => item.id))}
				className="flex flex-col p-1.5"
			>
				{reorderValues.map((item) => (
					<QueueItemRow
						key={item.id}
						item={item}
						sendNowTitle={labels.sendNow}
						deleteTitle={labels.delete}
						onSendNow={onSendNow}
						onRemove={onRemove}
					/>
				))}
			</Reorder.Group>
		</div>
	);
}

function QueueItemRow({
	item,
	sendNowTitle,
	deleteTitle,
	onSendNow,
	onRemove,
}: {
	item: QueueCardItem;
	sendNowTitle: string;
	deleteTitle: string;
	onSendNow: (id: string) => void;
	onRemove: (id: string) => void;
}): JSX.Element {
	const dragControls = useDragControls();

	return (
		<Reorder.Item
			value={item}
			dragListener={false}
			dragControls={dragControls}
			initial={{ opacity: 0, height: 0 }}
			animate={{ opacity: 1, height: "auto" }}
			exit={{ opacity: 0, height: 0 }}
			transition={{ duration: 0.15 }}
			className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted/30"
		>
			<button
				type="button"
				onPointerDown={(e) => dragControls.start(e)}
				className="flex shrink-0 cursor-grab touch-none items-center text-muted-foreground/50 transition-colors hover:text-muted-foreground active:cursor-grabbing"
			>
				<span className="icon-[solar--hamburger-menu-linear] text-sm" />
			</button>
			<div
				className="flex min-w-0 flex-1 select-text items-center gap-2 text-left text-[12px] leading-snug text-foreground"
				title={item.displayText}
			>
				{item.kind === "context_compaction" ? (
					<span className="h-3.5 w-3.5 shrink-0 rounded-full border border-primary" aria-hidden="true" />
				) : null}
				<span className="truncate">{item.displayText}</span>
			</div>
			{item.kind !== "context_compaction" && item.canSendNow !== false ? (
				<Button variant="ghost" size="xs" onClick={() => onSendNow(item.id)} title={sendNowTitle}>
					{sendNowTitle}
				</Button>
			) : null}
			<Button
				variant="ghost"
				size="icon-xs"
				onClick={() => onRemove(item.id)}
				title={deleteTitle}
				aria-label={deleteTitle}
				className="text-muted-foreground/60 hover:text-destructive focus-visible:text-destructive"
			>
				<span className="icon-[solar--trash-bin-trash-linear] text-sm" />
			</Button>
		</Reorder.Item>
	);
}
