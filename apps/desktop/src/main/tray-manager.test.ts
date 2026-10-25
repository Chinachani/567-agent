import type { EventEmitter } from "node:events";
import { app, nativeTheme } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Image {
	path: string;
	size?: number;
	template?: boolean;
	isEmpty(): boolean;
	resize(size: { width: number }): Image;
	setTemplateImage(value: boolean): void;
}

interface TestTray extends EventEmitter {
	image: Image;
	destroyed: boolean;
	menu: Electron.MenuItemConstructorOptions[];
}

const state = vi.hoisted(() => ({
	trays: [] as TestTray[],
	missing: new Set<string>(),
	quit: vi.fn(),
}));

vi.mock("electron", async () => {
	const { EventEmitter: Emitter } = await import("node:events");
	return {
		app: Object.assign(new Emitter(), { quit: state.quit }),
		nativeTheme: Object.assign(new Emitter(), { shouldUseDarkColors: false }),
		nativeImage: {
			createFromPath(path: string): Image {
				return {
					path,
					isEmpty: () => state.missing.has(path),
					resize({ width }) {
						this.size = width;
						return this;
					},
					setTemplateImage(value) {
						this.template = value;
					},
				};
			},
		},
		Menu: { buildFromTemplate: (items: Electron.MenuItemConstructorOptions[]) => items },
		Tray: class extends Emitter {
			image: Image;
			destroyed = false;
			menu: Electron.MenuItemConstructorOptions[] = [];
			constructor(image: Image) {
				super();
				this.image = image;
				state.trays.push(this);
			}
			setImage(image: Image) {
				this.image = image;
			}
			setToolTip() {}
			setContextMenu(menu: Electron.MenuItemConstructorOptions[]) {
				this.menu = menu;
			}
			destroy() {
				this.destroyed = true;
			}
		},
	};
});
vi.mock("./config/desktop-config-store.js", () => ({ readConfigSync: () => ({}), updateDesktopConfig: vi.fn() }));
vi.mock("./i18n/index.js", () => ({ mainT: (key: string) => key }));
vi.mock("./logger.js", () => ({ getAppLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }) }));
vi.mock("./window-manager.js", () => ({
	getMainWindow: () => null,
	showMainWindow: vi.fn(),
	iconPath: { linux: "app.png", win32: "app.ico", darwin: "app.icns" },
	trayIconPaths: { light: "tray-light.png", dark: "tray-dark.png", template: "trayTemplate.png" },
}));

const originalPlatform = process.platform;
const theme = nativeTheme as unknown as EventEmitter & { shouldUseDarkColors: boolean };
const lifecycle = app as unknown as EventEmitter;

beforeEach(() => {
	vi.resetModules();
	state.trays.length = 0;
	state.missing.clear();
	state.quit.mockClear();
	theme.shouldUseDarkColors = false;
});
afterEach(() => {
	lifecycle.emit("will-quit");
	Object.defineProperty(process, "platform", { value: originalPlatform });
});

describe("brand tray lifecycle", () => {
	it("updates day/night art, creates only one tray, and releases theme listeners on quit", async () => {
		Object.defineProperty(process, "platform", { value: "win32" });
		const { createTray, getTray } = await import("./tray-manager.js");
		createTray();
		createTray();
		expect(state.trays).toHaveLength(1);
		const tray = state.trays[0];
		expect(tray.image).toMatchObject({ path: "tray-light.png", size: 16 });
		theme.shouldUseDarkColors = true;
		theme.emit("updated");
		expect(tray.image.path).toBe("tray-dark.png");
		const quit = tray.menu.find((item) => item.label === "tray.quitVetta");
		if (typeof quit?.click !== "function") throw new Error("Quit action is missing");
		quit.click({} as Electron.MenuItem, undefined, {} as Electron.KeyboardEvent);
		expect(state.quit).toHaveBeenCalledOnce();
		expect(tray.destroyed).toBe(true);
		expect(getTray()).toBeNull();
		expect(theme.listenerCount("updated")).toBe(0);
		expect(lifecycle.listenerCount("will-quit")).toBe(0);
		createTray();
		expect(theme.listenerCount("updated")).toBe(1);
		lifecycle.emit("will-quit");
		expect(getTray()).toBeNull();
		expect(theme.listenerCount("updated")).toBe(0);
	});

	it("lets macOS render a monochrome template with the menu bar's contrast", async () => {
		Object.defineProperty(process, "platform", { value: "darwin" });
		const { createTray } = await import("./tray-manager.js");
		createTray();
		expect(state.trays[0].image).toMatchObject({ path: "trayTemplate.png", size: 22, template: true });
		expect(state.trays[0].listenerCount("click")).toBe(0);
	});

	it("keeps the tray usable if a dedicated asset is missing", async () => {
		Object.defineProperty(process, "platform", { value: "linux" });
		state.missing.add("tray-light.png");
		const { createTray } = await import("./tray-manager.js");
		createTray();
		expect(state.trays[0].image).toMatchObject({ path: "app.png", size: 22 });
	});
});
