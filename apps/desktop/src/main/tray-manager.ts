import { app, Menu, nativeImage, nativeTheme, Tray } from "electron";
import { readConfigSync, updateDesktopConfig } from "./config/desktop-config-store.js";
import { mainT } from "./i18n/index.js";
import { getAppLogger } from "./logger.js";
import { getMainWindow, iconPath, showMainWindow, trayIconPaths } from "./window-manager.js";

const log = getAppLogger("tray");

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

let tray: Tray | null = null;
let hideToTrayOnClose = true;

export function getHideToTrayOnClose(): boolean {
	return hideToTrayOnClose;
}

export async function setHideToTrayOnClose(value: boolean): Promise<void> {
	await updateDesktopConfig((config) => ({ ...config, hideToTrayOnClose: value }));
	hideToTrayOnClose = value;
	rebuildTrayContextMenu();
}

export function getTray(): Tray | null {
	return tray;
}

function buildTrayMenu(): Electron.Menu {
	const mainWindow = getMainWindow();
	const isVisible = mainWindow?.isVisible() ?? false;
	const toggleItem = {
		label: isVisible ? mainT("tray.hideWindow") : mainT("tray.showWindow"),
		click: () => {
			const win = getMainWindow();
			if (!win) return;
			if (win.isVisible()) {
				win.hide();
			} else {
				showMainWindow();
			}
			rebuildTrayContextMenu();
		},
	};

	// Mac 不接入 hide-to-tray 分支（close 走 Electron 默认隐藏窗口、应用留 Dock），
	// 菜单只保留显示/隐藏 + 退出，避免暴露在 Mac 上无效的切换项。
	if (isMac) {
		return Menu.buildFromTemplate([
			toggleItem,
			{ type: "separator" },
			{
				label: mainT("tray.quitVetta"),
				click: () => {
					(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
					destroyTray();
					app.quit();
				},
			},
		]);
	}

	return Menu.buildFromTemplate([
		toggleItem,
		{
			label: mainT("tray.closeToTray"),
			type: "checkbox",
			checked: hideToTrayOnClose,
			click: (item) => {
				void setHideToTrayOnClose(item.checked).catch((error: unknown) => {
					log.error("failed to save close-to-tray preference", error);
					rebuildTrayContextMenu();
				});
			},
		},
		{ type: "separator" },
		{
			label: mainT("tray.quitVetta"),
			click: () => {
				(app as typeof app & { isQuitting?: boolean }).isQuitting = true;
				destroyTray();
				app.quit();
			},
		},
	]);
}

function loadTrayIcon(): Electron.NativeImage {
	const path = isMac
		? trayIconPaths.template
		: nativeTheme.shouldUseDarkColors
			? trayIconPaths.dark
			: trayIconPaths.light;
	let icon = nativeImage.createFromPath(path);
	if (icon.isEmpty()) icon = nativeImage.createFromPath(iconPath[process.platform]);
	if (icon.isEmpty()) return icon;
	const size = isWindows ? 16 : 22;
	icon = icon.resize({ width: size, height: size });
	if (isMac) icon.setTemplateImage(true);
	return icon;
}

function updateTrayIcon(): void {
	if (!tray) return;
	const icon = loadTrayIcon();
	if (!icon.isEmpty()) tray.setImage(icon);
}

function destroyTray(): void {
	nativeTheme.removeListener("updated", updateTrayIcon);
	app.removeListener("will-quit", destroyTray);
	tray?.destroy();
	tray = null;
}

export function createTray(): void {
	if (tray) return;
	hideToTrayOnClose = readConfigSync().hideToTrayOnClose ?? true;

	const trayIcon = loadTrayIcon();
	log.debug(`Icon loaded: platform=${process.platform}, isEmpty=${trayIcon.isEmpty()}`);
	if (trayIcon.isEmpty()) {
		log.warn("Icon not found, skipping tray creation");
		return;
	}

	tray = new Tray(trayIcon);
	log.info("Created successfully");
	tray.setToolTip(mainT("menu.app.title"));
	tray.setContextMenu(buildTrayMenu());
	nativeTheme.on("updated", updateTrayIcon);
	app.once("will-quit", destroyTray);

	// Mac 状态栏惯例：左/右键都由 setContextMenu 默认弹菜单，不另绑 click。
	// Win/Linux：左键切换主窗口显隐，右键走上下文菜单。
	if (!isMac) {
		tray.on("click", () => {
			const win = getMainWindow();
			if (!win) return;
			if (win.isVisible()) {
				win.hide();
			} else {
				showMainWindow();
			}
			rebuildTrayContextMenu();
		});
	}
}

export function rebuildTrayContextMenu(): void {
	if (!tray) return;
	tray.setContextMenu(buildTrayMenu());
}
