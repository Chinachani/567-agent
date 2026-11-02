import { AnimatePresence, motion } from "motion/react";
import type { JSX, RefObject } from "react";
import { usePanelViewportHeight } from "./usePanelViewportHeight";
import { FadingScrollArea } from "./FadingScrollArea";
import { ThemeSurface } from "../appearance/ThemeSurface";

export interface AtPanelClassNames {
	root?: string;
	content?: string;
	header?: string;
	list?: string;
	item?: string;
}

export interface AtPanelEntryModel {
	path: string;
	name: string;
	isDirectory: boolean;
	relPath?: string;
	/** Optional extension metadata. File entries omit this field. */
	kind?: string;
	avatar?: string;
	meta?: string;
	index: number;
	active: boolean;
	icon: string;
}

export interface AtPanelLabels {
	header: string;
	headingMeta: string;
	loading: string;
	noResults: string;
	emptyDirectory: string;
	goUp: string;
	enterDirectory: string;
}

export interface AtPanelViewProps {
	open: boolean;
	loading: boolean;
	normalizedFilter: string;
	canGoUp: boolean;
	goUpActive: boolean;
	entries: AtPanelEntryModel[];
	labels: AtPanelLabels;
	panelRef: RefObject<HTMLDivElement | null>;
	className?: string;
	classNames?: AtPanelClassNames;
	onGoUp: () => void;
	onHoverIndex: (index: number) => void;
	onEntryClick: (entry: AtPanelEntryModel) => void;
}

export function AtPanelView({
	open,
	loading,
	normalizedFilter,
	canGoUp,
	goUpActive,
	entries,
	labels,
	panelRef,
	className,
	classNames,
	onGoUp,
	onHoverIndex,
	onEntryClick,
}: AtPanelViewProps): JSX.Element {
	const syncHeight = usePanelViewportHeight(panelRef, open);
	return (
		<AnimatePresence>
			{open && (
				<motion.div
					ref={panelRef}
					onAnimationComplete={syncHeight}
					initial={{ opacity: 0, y: 8, scaleY: 0.96 }}
					animate={{ opacity: 1, y: 0, scaleY: 1 }}
					exit={{ opacity: 0, y: 8, scaleY: 0.96 }}
					transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
					className={[
						"absolute inset-x-0 bottom-full z-50 mb-1.5 origin-bottom flex min-h-0 max-h-[min(320px,calc(100dvh-260px),var(--panel-available-height,320px))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-md",
						className,
						classNames?.root,
					]
						.filter(Boolean)
						.join(" ")}
				>
					<ThemeSurface slot="chat.atPanel" />
					<div
						className={[
							"relative z-10 flex min-h-0 flex-col overflow-hidden rounded-[inherit]",
							classNames?.content,
						]
							.filter(Boolean)
							.join(" ")}
					>
						<div
							className={[
								"flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5",
								classNames?.header,
							]
								.filter(Boolean)
								.join(" ")}
						>
							<span
								aria-hidden="true"
								className="icon-[solar--mention-circle-linear] h-4 w-4 shrink-0 text-muted-foreground"
							/>
							<span className="min-w-0 truncate text-[12px] font-medium text-foreground" title={labels.header}>
								{labels.header}
							</span>
							<span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
								{labels.headingMeta}
							</span>
						</div>

						<FadingScrollArea aria-label={labels.header}>
							{loading ? (
								<div className="flex items-center justify-center py-8 text-[12px] text-muted-foreground">
									{labels.loading}
								</div>
							) : entries.length === 0 && !canGoUp ? (
								<div className="flex items-center justify-center py-8 text-[12px] text-muted-foreground">
									{normalizedFilter ? labels.noResults : labels.emptyDirectory}
								</div>
							) : (
								<div className={["py-1", classNames?.list].filter(Boolean).join(" ")}>
									{canGoUp && (
										<button
											type="button"
											data-index={0}
											onMouseEnter={() => onHoverIndex(0)}
											onClick={onGoUp}
											className={[
												"relative flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors",
												goUpActive ? "bg-primary/10" : "bg-transparent",
												classNames?.item,
											]
												.filter(Boolean)
												.join(" ")}
										>
											{goUpActive && (
												<motion.span
													layoutId="at-active-marker"
													className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
													transition={{ type: "spring", stiffness: 500, damping: 32 }}
												/>
											)}
											<span
												aria-hidden="true"
												className="icon-[solar--arrow-left-up-linear] h-4 w-4 text-muted-foreground"
											/>
											<span className="text-[12px] text-muted-foreground" title={labels.goUp}>
												{labels.goUp}
											</span>
										</button>
									)}

									{entries.map((entry) => (
										<AtPanelEntry
											key={entry.path}
											entry={entry}
											className={classNames?.item}
											enterDirectoryLabel={labels.enterDirectory}
											onHover={() => onHoverIndex(entry.index)}
											onClick={() => onEntryClick(entry)}
										/>
									))}
								</div>
							)}
						</FadingScrollArea>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}

function AtPanelEntry({
	entry,
	className,
	enterDirectoryLabel,
	onHover,
	onClick,
}: {
	entry: AtPanelEntryModel;
	className?: string;
	enterDirectoryLabel: string;
	onHover: () => void;
	onClick: () => void;
}): JSX.Element {
	return (
		<button
			type="button"
			data-index={entry.index}
			onMouseEnter={onHover}
			onClick={onClick}
			className={[
				"relative flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors",
				entry.active ? "bg-primary/10" : "bg-transparent",
				className,
			]
				.filter(Boolean)
				.join(" ")}
		>
			{entry.active && (
				<motion.span
					layoutId="at-active-marker"
					className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-primary"
					transition={{ type: "spring", stiffness: 500, damping: 32 }}
				/>
			)}
			{entry.avatar ? (
				<img src={entry.avatar} alt="" className="h-5 w-5 shrink-0 rounded-full object-cover" />
			) : (
				<span aria-hidden="true" className={`${entry.icon} h-4 w-4 shrink-0 text-muted-foreground`} />
			)}
			<span
				className={`min-w-0 truncate text-[13px] ${entry.isDirectory ? "font-medium text-foreground" : "text-foreground"}`}
				title={entry.name}
			>
				{entry.name}
			</span>
			{entry.meta ? (
				<span
					className="ml-auto min-w-0 max-w-[45%] truncate text-right text-[11px] text-muted-foreground"
					title={entry.meta}
				>
					{entry.meta}
				</span>
			) : null}
			{entry.relPath && entry.relPath !== entry.name && (
				<span
					className="ml-auto min-w-0 max-w-[45%] truncate text-right font-mono text-[11px] text-muted-foreground"
					title={entry.relPath}
				>
					{entry.relPath}
				</span>
			)}
			{entry.isDirectory && (
				<span className="ml-auto shrink-0 text-[11px] text-muted-foreground" title={enterDirectoryLabel}>
					{enterDirectoryLabel}
				</span>
			)}
		</button>
	);
}
