import { CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID } from "@567agent/coding-agent/settings";
import type { IpcRenderer, WebContents } from "electron";
import { beforeEach, expect, it, vi } from "vitest";
import { createRuntimeConfigurationApi } from "../../preload/apis/runtime-configuration.js";
import { RUNTIME_CONFIGURATION_CHANNELS } from "../../shared/runtime-configuration-ipc.js";
import { DesktopRuntimeConfigurationService } from "../runtime-configuration/runtime-configuration-service.js";

const state = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	service: undefined as DesktopRuntimeConfigurationService | undefined,
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (name: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(name, handler),
		removeHandler: (name: string) => state.handlers.delete(name),
	},
}));
vi.mock("../runtime-configuration/runtime-configuration-composition.js", () => ({
	getDesktopRuntimeConfigurationService: () => state.service,
}));
beforeEach(() => state.handlers.clear());

it("guards runtime settings and carries model-call edits through preload, persistence and reread", async () => {
	let document: Record<string, unknown> = { custom: "keep" };
	state.service = new DesktopRuntimeConfigurationService({
		readAgentSettings: () => structuredClone(document),
		updateAgentSettings: (mutate) => {
			document = structuredClone(document);
			mutate(document);
		},
		logger: { info: vi.fn(), warn: vi.fn() },
	});
	let destroyed = false;
	const owner = { mainFrame: {}, isDestroyed: () => destroyed, send: vi.fn() } as unknown as WebContents;
	const valid = { sender: owner, senderFrame: owner.mainFrame };
	const { registerRuntimeConfigurationIpc } = await import("./runtime-configuration.js");
	const dispose = registerRuntimeConfigurationIpc(owner);
	const api = createRuntimeConfigurationApi({
		invoke: async (channel: string, ...args: unknown[]) => state.handlers.get(channel)!(valid, ...args),
	} as IpcRenderer).runtimeConfiguration;
	try {
		for (const [channel, args] of [
			[RUNTIME_CONFIGURATION_CHANNELS.LIST, []],
			[RUNTIME_CONFIGURATION_CHANNELS.SET, [CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID, { enabled: false }]],
		] as const) {
			const handler = state.handlers.get(channel)!;
			for (const event of [
				{ sender: {}, senderFrame: owner.mainFrame },
				{ sender: owner, senderFrame: {} },
				{ sender: owner, senderFrame: null },
			])
				await expect(Promise.resolve().then(() => handler(event, ...args))).rejects.toThrow(/Untrusted/);
			destroyed = true;
			await expect(Promise.resolve().then(() => handler(valid, ...args))).rejects.toThrow(/Untrusted/);
			destroyed = false;
		}
		expect(document).toEqual({ custom: "keep" });
		await api.set(CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID, { enabled: false, maxCalls: 350 });
		expect(
			(await api.list()).entries.find(
				(entry) => entry.configurationId === CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID,
			)?.value,
		).toEqual({ enabled: false, maxCalls: 350 });
		await expect(api.set(CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID, { maxCalls: 0 })).rejects.toThrow();
		expect(document.custom).toBe("keep");
	} finally {
		dispose();
		await state.service.close();
	}
	expect(state.handlers.size).toBe(0);
});
