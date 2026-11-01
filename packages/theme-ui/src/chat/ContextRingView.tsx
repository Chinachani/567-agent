import { AnimatePresence, motion } from "motion/react";
import { type JSX, useState } from "react";

const SIZE = 16;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SPIN_ARC = CIRCUMFERENCE * 0.25;

export interface ContextRingViewProps {
	/** Progress 0–100; ignored while compacting. */
	percent: number;
	/** Precomputed dashoffset for progress arc. */
	offset: number;
	/** Progress arc stroke color. */
	color: string;
	isCompacting: boolean;
	/** Omit while the host's context details are open. */
	tooltip?: string;
	className?: string;
}

export function ContextRingView({
	percent,
	offset,
	color,
	isCompacting,
	tooltip,
	className,
}: ContextRingViewProps): JSX.Element {
	const [hovered, setHovered] = useState(false);

	return (
		<div
			className={`relative flex items-center cursor-default${className ? ` ${className}` : ""}`}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<svg
				aria-hidden="true"
				width={SIZE}
				height={SIZE}
				className={isCompacting ? "" : "rotate-[-90deg]"}
				opacity={!isCompacting && percent === 0 ? 0.6 : 1}
				style={isCompacting ? { animation: "context-ring-spin 1s linear infinite" } : undefined}
			>
				<circle
					cx={SIZE / 2}
					cy={SIZE / 2}
					r={RADIUS}
					fill="none"
					stroke="currentColor"
					className="text-muted-foreground/40"
					strokeWidth={STROKE}
				/>
				{isCompacting ? (
					<circle
						cx={SIZE / 2}
						cy={SIZE / 2}
						r={RADIUS}
						fill="none"
						stroke="currentColor"
						className="text-amber-600 dark:text-amber-400"
						strokeWidth={STROKE}
						strokeDasharray={`${SPIN_ARC} ${CIRCUMFERENCE - SPIN_ARC}`}
						strokeLinecap="round"
					/>
				) : percent > 0 ? (
					<circle
						cx={SIZE / 2}
						cy={SIZE / 2}
						r={RADIUS}
						fill="none"
						stroke={color}
						strokeWidth={STROKE}
						strokeDasharray={CIRCUMFERENCE}
						strokeDashoffset={offset}
						strokeLinecap="round"
						style={{ transition: "stroke-dashoffset 0.4s ease, stroke 0.3s ease" }}
					/>
				) : null}
			</svg>
			{tooltip ? (
				<AnimatePresence>
					{hovered && (
						<motion.div
							initial={{ opacity: 0, y: 4 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: 4 }}
							transition={{ duration: 0.15 }}
							role="tooltip"
							className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md pointer-events-none"
						>
							{tooltip}
						</motion.div>
					)}
				</AnimatePresence>
			) : null}
		</div>
	);
}

export { CIRCUMFERENCE };
