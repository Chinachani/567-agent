import type { IpcMainInvokeEvent, IpcRenderer, WebContents, WebUtils } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { createSystemApi } from "../../preload/apis/system.js";

const fake = vi.hoisted(() => ({
	handlers: new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(),
	service: {
		check: vi.fn(),
		syncInBackground: vi.fn(),
		getState: vi.fn(),
		startDownload: vi.fn(),
		pauseDownload: vi.fn(),
		install: vi.fn(),
		dismissReady: vi.fn(),
		cancel: vi.fn(),
		getPreferences: vi.fn(),
		setPreferences: vi.fn(),
	},
	history: { get: vi.fn() },
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
			fake.handlers.set(channel, handler),
		removeHandler: (channel: string) => fake.handlers.delete(channel),
	},
}));
vi.mock("../updater.js", () => ({
	updaterService: fake.service,
	updateReleaseHistory: fake.history,
	getAppVersion: () => "1.5.0",
}));

import { registerUpdaterIpc } from "./updater.js";

afterEach(() => {
	fake.handlers.clear();
	vi.clearAllMocks();
});
it("all updater channels reject unrelated windows, subframes and a destroyed owner before doing work", async () => {
	let destroyed = false;
	const owner = { mainFrame: {}, isDestroyed: () => destroyed } as WebContents;
	const cleanup = registerUpdaterIpc(owner);
	expect(fake.handlers.size).toBe(12);
	for (const handler of fake.handlers.values()) {
		for (const event of [
			{ sender: {}, senderFrame: owner.mainFrame },
			{ sender: owner, senderFrame: {} },
			{ sender: owner, senderFrame: null },
		]) {
			await expect(Promise.resolve().then(() => handler(event as IpcMainInvokeEvent))).rejects.toThrow("Untrusted");
		}
	}
	destroyed = true;
	for (const handler of fake.handlers.values())
		await expect(
			Promise.resolve().then(() => handler({ sender: owner, senderFrame: owner.mainFrame } as IpcMainInvokeEvent)),
		).rejects.toThrow("Untrusted");
	for (const method of Object.values(fake.service)) expect(method).not.toHaveBeenCalled();
	expect(fake.history.get).not.toHaveBeenCalled();
	cleanup();
	expect(fake.handlers.size).toBe(0);
});
it("preload invokes the trusted preference and history contracts and rejects malformed preferences", async () => {
	const owner = { mainFrame: {}, isDestroyed: () => false } as WebContents;
	const event = { sender: owner, senderFrame: owner.mainFrame } as IpcMainInvokeEvent;
	registerUpdaterIpc(owner);
	const ipc = {
		invoke: async (channel: string, ...args: unknown[]) => fake.handlers.get(channel)!(event, ...args),
	} as IpcRenderer;
	const api = createSystemApi(ipc, {} as WebUtils).updater;
	const preferences = {
		automaticCheck: false,
		automaticDownload: false,
		checkIntervalMinutes: 360,
		showReminder: false,
	};
	fake.service.setPreferences.mockResolvedValue(preferences);
	fake.service.getPreferences.mockResolvedValue(preferences);
	fake.history.get.mockResolvedValue({ baselineVersion: "1.4.4", releases: [] });
	expect(await api.setPreferences(preferences)).toEqual(preferences);
	expect(await api.getPreferences()).toEqual(preferences);
	expect(await api.getReleaseHistory()).toMatchObject({ baselineVersion: "1.4.4" });
	await api.pause();
	expect(fake.service.pauseDownload).toHaveBeenCalledOnce();
	await expect(
		ipc.invoke("agent567:updater:set-preferences", { ...preferences, checkIntervalMinutes: 1 }),
	).rejects.toThrow("Invalid");
	expect(fake.service.setPreferences).toHaveBeenCalledOnce();
});
