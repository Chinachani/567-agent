// 应用图标：id 持久化在 desktop-config.appIconId。设置页经 setAppIconId 进来，
// 启动时 applyAppIcon 套用一次。运行时只能换 Dock / 窗口图标；Finder 里的 .app 文件图标
// 与安装包图标由打包决定，这里改不了。

import { join } from "node:path";
import { app, BrowserWindow, type NativeImage, nativeImage } from "electron";
import { APP_ICON_DEFAULT, type AppIconId, isAppIconId, normalizeAppIconId } from "../../shared/app-icon.js";
import { readConfigSync, updateDesktopConfig } from "../config/desktop-config-store.js";

export const APP_ICON_CHANGED_CHANNEL = "vetta:app-icon:changed";

const buildDir = app.isPackaged ? join(process.resourcesPath, "build") : join(process.cwd(), "build");

let currentId: AppIconId | undefined;

export function getAppIconId(): AppIconId {
	currentId ??= normalizeAppIconId(readConfigSync().appIconId);
	return currentId;
}

/** 出厂图标走打包默认（Dock 用 icon-dock.png，已自带 824 本体与边距；窗口用平台图标），返回 undefined 表示「用默认」。 */
function appIconImage(id: AppIconId): NativeImage | undefined {
	if (id === APP_ICON_DEFAULT) return undefined;
	// Dock 不会给 setIcon 的图片加遮罩，macOS 用自带 824 超椭圆与边距的 -mac 版本；其余平台用全幅方形。
	const suffix = process.platform === "darwin" ? "-mac" : "";
	const image = nativeImage.createFromPath(join(buildDir, "app-icons", `${id}${suffix}.png`));
	return image.isEmpty() ? undefined : image;
}

/** 非 macOS 的窗口图标：创建窗口时用，选了非默认图标才覆盖。 */
export function getWindowIconOverride(): NativeImage | undefined {
	return process.platform === "darwin" ? undefined : appIconImage(getAppIconId());
}

/** 把当前图标套到 Dock（macOS）与所有已开窗口（Windows / Linux）。 */
export function applyAppIcon(): void {
	const id = getAppIconId();
	const image = appIconImage(id);
	if (process.platform === "darwin") {
		app.dock?.setIcon(image ?? nativeImage.createFromPath(join(buildDir, "icon-dock.png")));
		return;
	}
	const fallback = nativeImage.createFromPath(join(buildDir, process.platform === "win32" ? "icon.ico" : "icon.png"));
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.setIcon(image ?? fallback);
	}
}

/** Commit first; failed writes must not change the displayed or broadcast preference. */
let mutation: Promise<unknown> = Promise.resolve();
export function setAppIconId(value: unknown): Promise<AppIconId> {
	if (!isAppIconId(value)) return Promise.reject(new Error("Invalid application icon"));
	const next = value;
	const run = async (): Promise<AppIconId> => {
		if (next === getAppIconId()) return next;
		if (next !== APP_ICON_DEFAULT && !appIconImage(next)) throw new Error("Application icon is unavailable");
		await updateDesktopConfig((config) => ({ ...config, appIconId: next }));
		currentId = next;
		applyAppIcon();
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) win.webContents.send(APP_ICON_CHANGED_CHANNEL, next);
		}
		return next;
	};
	const pending = mutation.then(run, run);
	mutation = pending;
	return pending;
}
