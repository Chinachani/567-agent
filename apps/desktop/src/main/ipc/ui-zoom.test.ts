import type { IpcRenderer, WebContents } from "electron";
import { expect, it, vi } from "vitest";
import { createUiZoomApi } from "../../preload/apis/ui-zoom.js";

const state = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>(), factor: 1 }));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (key: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(key, handler),
		removeHandler: (key: string) => state.handlers.delete(key),
	},
}));
vi.mock("../ui-zoom/ui-zoom-service.js", () => ({
	getUiZoomFactor: () => state.factor,
	setUiZoomFactor: async (factor: number) => {
		state.factor = factor;
		return factor;
	},
	stepUiZoom: async () => {
		state.factor = 1.1;
		return 1.1;
	},
}));
it("bridges preload to trusted main-window IPC, rejects guests and invalid values, and tears down", async () => {
	const { registerUiZoomIpc } = await import("./ui-zoom.js");
	const owner = { mainFrame: {}, isDestroyed: () => false } as unknown as WebContents;
	const event = { sender: owner, senderFrame: owner.mainFrame };
	const dispose = registerUiZoomIpc(owner);
	const api = createUiZoomApi({
		invoke: async (key: string, ...args: unknown[]) => state.handlers.get(key)!(event, ...args),
	} as IpcRenderer).uiZoom;
	await expect(api.get()).resolves.toBe(1);
	await expect(api.set(1.25)).resolves.toBe(1.25);
	await expect(api.step(1)).resolves.toBe(1.1);
	for (const handler of state.handlers.values()) {
		for (const bad of [
			{ sender: {}, senderFrame: owner.mainFrame },
			{ sender: owner, senderFrame: {} },
		])
			expect(() => handler(bad, 1)).toThrow(/Untrusted/);
	}
	for (const value of [NaN, Infinity, "1.25", null])
		expect(() => state.handlers.get("vetta:ui-zoom:set")!(event, value)).toThrow();
	expect(() => state.handlers.get("vetta:ui-zoom:step")!(event, 2)).toThrow();
	dispose();
	expect(state.handlers.size).toBe(0);
});
