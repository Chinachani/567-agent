// 应用图标（设置 → 外观 → 应用图标）。主进程持久化并应用，renderer 只读写同一个 id。

import previews from "./app-icon-catalog.json";

export type AppIconId = keyof typeof previews;
export const APP_ICON_PREVIEWS = previews;
export const APP_ICON_IDS: readonly AppIconId[] = Object.keys(previews) as AppIconId[];

export const APP_ICON_DEFAULT: AppIconId = "default";

export function isAppIconId(value: unknown): value is AppIconId {
	return typeof value === "string" && (APP_ICON_IDS as readonly string[]).includes(value);
}

/** 未知或缺失的值回落默认，兼容将来删减图标后的旧配置。 */
export function normalizeAppIconId(value: unknown): AppIconId {
	return isAppIconId(value) ? value : APP_ICON_DEFAULT;
}
