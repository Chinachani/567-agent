import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ config: { uiZoomFactor: 1 }, fail: false }));
vi.mock("../config/desktop-config-store.js", () => ({
	readConfigSync: () => state.config,
	updateDesktopConfig: async (mutate: (config: typeof state.config) => typeof state.config) => {
		if (state.fail) throw new Error("disk full");
		state.config = mutate(state.config);
		return state.config;
	},
}));
function contents() {
	const emitter = new EventEmitter();
	let zoom = 1;
	let destroyed = false;
	return Object.assign(emitter, {
		isDestroyed: () => destroyed,
		getZoomFactor: () => zoom,
		setZoomFactor: vi.fn((value: number) => {
			zoom = value;
		}),
		send: vi.fn(),
		destroy: () => {
			destroyed = true;
			emitter.emit("destroyed");
		},
	});
}
beforeEach(() => {
	state.config = { uiZoomFactor: 1 };
	state.fail = false;
	vi.resetModules();
});
describe("main window zoom", () => {
	it("loads persisted zoom, commits rapid steps in order and restores it on reload/recreation", async () => {
		const api = await import("./ui-zoom-service.js");
		const main = contents();
		const guest = contents();
		api.attachUiZoom(main as unknown as WebContents);
		await Promise.all([api.stepUiZoom(1), api.stepUiZoom(1)]);
		expect(state.config.uiZoomFactor).toBe(1.25);
		expect(main.getZoomFactor()).toBe(1.25);
		expect(guest.getZoomFactor()).toBe(1);
		main.setZoomFactor(1);
		main.emit("did-finish-load");
		expect(main.getZoomFactor()).toBe(1.25);
		main.destroy();
		expect(main.listenerCount("did-finish-load")).toBe(0);
		const next = contents();
		api.attachUiZoom(next as unknown as WebContents);
		expect(next.getZoomFactor()).toBe(1.25);
		await api.resetUiZoom();
		expect(next.getZoomFactor()).toBe(1);
		expect(next.send).toHaveBeenLastCalledWith("vetta:ui-zoom:changed", 1);
	});
	it("failed persistence changes neither the window nor current factor and permits retry", async () => {
		const api = await import("./ui-zoom-service.js");
		const main = contents();
		api.attachUiZoom(main as unknown as WebContents);
		state.fail = true;
		await expect(api.setUiZoomFactor(1.5)).rejects.toThrow("disk full");
		expect(api.getUiZoomFactor()).toBe(1);
		expect(main.getZoomFactor()).toBe(1);
		expect(main.send).not.toHaveBeenCalled();
		state.fail = false;
		await api.setUiZoomFactor(1.5);
		expect(main.getZoomFactor()).toBe(1.5);
	});
});
