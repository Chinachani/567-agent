import { motion } from "motion/react";
import type { JSX, ReactNode } from "react";

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface SkillTagGroupViewProps {
	readonly enabledCountLabel?: string;
	readonly isScene: boolean;
	readonly items: ReactNode;
	readonly skillCount: number;
	readonly tag: string;
}

export function SkillTagGroupView({
	enabledCountLabel,
	isScene,
	items,
	skillCount,
	tag,
}: SkillTagGroupViewProps): JSX.Element {
	return (
		<motion.div
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.4, ease: easeOut }}
		>
			<div className="mb-3 flex items-baseline gap-2">
				<h3 className="text-[13px] font-semibold text-foreground">{tag}</h3>
				<span className="text-[11px] tabular-nums text-muted-foreground">{skillCount}</span>
				{enabledCountLabel && (
					<>
						<span className="text-muted-foreground/25">·</span>
						<span className="text-[11px] text-muted-foreground">{enabledCountLabel}</span>
					</>
				)}
			</div>
			<motion.div
				className={
					isScene
						? "grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-2.5"
						: "grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-x-2 gap-y-0.5"
				}
				initial="hidden"
				animate="show"
				variants={{
					hidden: {},
					show: { transition: { staggerChildren: 0.04 } },
				}}
			>
				{items}
			</motion.div>
		</motion.div>
	);
}
