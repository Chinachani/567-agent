import type { CSSProperties } from "react";

/**
 * Usage-domain semantic palette backed exclusively by existing theme CSS
 * variables (`--chart-*`, `--context-segment-*`, `--foreground`, `--card`,
 * `--border`) so colors adapt across Mono, Coral, Classic, dark, and light
 * modes without turning into flat gray under the Mono default theme.
 */
export const USAGE_PRIMARY_ACCENT = "var(--chart-2)";
export const USAGE_WARM_ACCENT = "var(--chart-1)";

export const USAGE_TOKEN_SEGMENT_COLORS = {
	prompt: "var(--context-segment-1)",
	completion: "var(--context-segment-3)",
	cacheRead: "var(--context-segment-4)",
	cacheWrite: "var(--context-segment-2)",
} as const;

export const USAGE_DISTRIBUTION_SERIES = [
	"var(--chart-2)",
	"var(--context-segment-2)",
	"var(--context-segment-3)",
	"var(--context-segment-4)",
	"var(--context-segment-5)",
] as const;

/** Returns a subtle 1px-bordered tinted card surface for primary hero emphasis. */
export function usageCardTintStyle(tokenVar: string): CSSProperties {
	return {
		backgroundColor: `color-mix(in srgb, ${tokenVar} 7%, var(--card))`,
		borderColor: `color-mix(in srgb, ${tokenVar} 30%, var(--border))`,
	};
}

/** Returns high-contrast foreground-blended accent text for both dark and light modes. */
export function usageAccentTextStyle(tokenVar: string): CSSProperties {
	return {
		color: `color-mix(in srgb, ${tokenVar} 50%, var(--foreground))`,
	};
}

/** Returns a tinted pill style whose label matches its paired chart or bar segment. */
export function usageBadgeStyle(tokenVar: string): CSSProperties {
	return {
		...usageAccentTextStyle(tokenVar),
		backgroundColor: `color-mix(in srgb, ${tokenVar} 14%, transparent)`,
	};
}
