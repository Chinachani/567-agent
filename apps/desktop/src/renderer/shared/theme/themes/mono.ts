import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// The built-in 567 palette; alternative and installed themes keep their own tokens.
const fontSans = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

export const monoTheme: ThemeDef = {
	id: "mono",
	label: "Default",
	dark: {
		...defaultTheme.dark,
		fontSans,
		background: "#1a1a19",
		card: "#262625",
		popover: "#2d2d2b",
		muted: "#20201f",
		secondary: "#302f2c",
		foreground: "#edece9",
		cardForeground: "#edece9",
		popoverForeground: "#edece9",
		secondaryForeground: "#edece9",
		accentForeground: "#edece9",
		mutedForeground: "#b1aea7",
		border: "#42413e",
		input: "#585651",
		inputBarBg: "#262625",
		primary: "#edece9",
		primaryForeground: "#191918",
		accent: "#393835",
		ring: "#f2b657",
	},
	light: {
		...defaultTheme.light,
		fontSans,
		background: "#f8f7f5",
		card: "#ffffff",
		popover: "#ffffff",
		muted: "#f0efec",
		secondary: "#eae9e6",
		foreground: "#242422",
		cardForeground: "#242422",
		popoverForeground: "#242422",
		secondaryForeground: "#242422",
		accentForeground: "#242422",
		mutedForeground: "#5e5c57",
		border: "#d9d7d1",
		input: "#c1beb6",
		inputBarBg: "#ffffff",
		primary: "#242422",
		primaryForeground: "#ffffff",
		accent: "#e6e4de",
		ring: "#94600b",
	},
};
