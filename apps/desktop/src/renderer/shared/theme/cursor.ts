export type CursorStyle = "default";

/** 当前使用的存储键：值是 CursorStyle。 */
export const CURSOR_STORAGE_KEY = "vetta-cursor-style";

/** 旧开关键（true/false），读取时兼容迁移。 */
export const LEGACY_CURSOR_STORAGE_KEY = "vetta-custom-cursor";

export function isCursorStyle(value: string | null | undefined): value is CursorStyle {
	return value === "default";
}

export function getStoredCursorStyle(): CursorStyle {
	localStorage.removeItem(CURSOR_STORAGE_KEY);
	localStorage.removeItem(LEGACY_CURSOR_STORAGE_KEY);
	return "default";
}

export function applyCursorStyle(_style: CursorStyle): void {
	document.documentElement.classList.remove("custom-cursor");
}

export function setStoredCursorStyle(_style: CursorStyle): void {
	localStorage.removeItem(LEGACY_CURSOR_STORAGE_KEY);
	localStorage.removeItem(CURSOR_STORAGE_KEY);
	applyCursorStyle("default");
}

export function applyStoredCursorStyle(): void {
	applyCursorStyle(getStoredCursorStyle());
}

/** @deprecated 使用 applyStoredCursorStyle */
export const applyStoredCustomCursor = applyStoredCursorStyle;
