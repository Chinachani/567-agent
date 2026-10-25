import type { ThemeDef } from "../tokens";
import { defaultTheme } from "./default";

// 「默认」主题：经典色板基础上把主色替换为黑/白。
// 深色模式 primary = 白，浅色模式 primary = 黑；ring 与 primary 一致。

export const monoTheme: ThemeDef = {
	id: "mono",
	label: "Default",
	dark: {
		...defaultTheme.dark,
		background: "rgb(20, 20, 22)",
		muted: "rgb(26, 26, 28)",
		card: "rgb(29, 29, 32)",
		// 覆盖经典偏蓝 popover/border，侧栏设置菜单等浮层保持中性灰
		popover: "rgb(32, 32, 35)",
		// 正文与辅助文字拉开层级，暗色下辅助信息仍保持可读。
		foreground: "rgb(224, 224, 228)",
		cardForeground: "rgb(224, 224, 228)",
		popoverForeground: "rgb(224, 224, 228)",
		secondaryForeground: "rgb(224, 224, 228)",
		accentForeground: "rgb(224, 224, 228)",
		mutedForeground: "rgb(157, 157, 166)",
		border: "rgb(48, 48, 52)",
		input: "rgb(48, 48, 48)",
		inputBarBg: "rgb(29, 29, 32)",
		// 强调色仍偏亮但略软于纯白，实心按钮不刺眼
		primary: "rgb(228, 228, 228)",
		primaryForeground: "rgb(8, 8, 10)",
		ring: "rgb(228, 228, 228)",
		// hover 与浮层保持可辨的层次。
		accent: "rgb(46, 46, 50)",
	},
	light: {
		...defaultTheme.light,
		// 纯白画布；card 略压深以便与 bg 分层
		background: "rgb(255, 255, 255)",
		card: "rgb(250, 250, 252)",
		popover: "rgb(255, 255, 255)",
		muted: "rgb(244, 244, 246)",
		// secondary 略深于 muted，便于 bg-secondary 可辨
		secondary: "rgb(240, 240, 241)",
		// 浅色细边线与卡片、输入区保持可辨的层次。
		border: "rgb(224, 224, 230)",
		input: "rgb(224, 224, 230)",
		inputBarBg: "rgb(255, 255, 255)",
		primary: "rgb(0, 0, 0)",
		primaryForeground: "rgb(255, 255, 255)",
		ring: "rgb(0, 0, 0)",
		// card hover；略深于 card，但不过重
		accent: "rgb(232, 232, 232)",
	},
};
