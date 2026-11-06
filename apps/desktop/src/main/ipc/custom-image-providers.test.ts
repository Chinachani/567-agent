import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcRenderer, WebContents, WebUtils } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { createSystemApi } from "../../preload/apis/system.js";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { CredentialVault } from "../credentials/credential-vault.js";
import { JobManager } from "../jobs/job-manager.js";
import { CustomImageProviderManager } from "../media-generation/custom-image-provider-manager.js";
import { MediaArtifactStore } from "../media-generation/media-artifact-store.js";
import { MediaProviderRegistry } from "../media-generation/media-provider-registry.js";

const state = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	manager: undefined as CustomImageProviderManager | undefined,
}));
vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(channel, handler),
		removeHandler: (channel: string) => state.handlers.delete(channel),
	},
}));
vi.mock("../capabilities/media-providers.js", () => ({
	getDesktopMediaRuntime: () => ({ customImageProviders: state.manager }),
}));
vi.mock("./fs.js", () => ({ assertPathReadableForPreview: vi.fn() }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ warn: vi.fn() }) }));

afterEach(() => state.handlers.clear());

it("bridges image-service CRUD through trusted IPC with validated, key-free results", async () => {
	const directory = mkdtempSync(join(tmpdir(), "agent567-image-ipc-"));
	const artifacts = new ArtifactStore({ root: join(directory, "artifacts") });
	const vault = new CredentialVault(join(directory, "vault"), {
		backend: "test",
		isAvailable: () => true,
		encrypt: (text) => Buffer.from(text).toString("base64"),
		decrypt: (text) => Buffer.from(text, "base64").toString(),
	});
	const manager = new CustomImageProviderManager(
		new MediaProviderRegistry(new JobManager()),
		new MediaArtifactStore(artifacts),
		{ vault, storePath: join(directory, "providers.json"), fetch: vi.fn() },
	);
	state.manager = manager;
	let destroyed = false;
	const owner = { mainFrame: {}, isDestroyed: () => destroyed } as unknown as WebContents;
	const valid = { sender: owner, senderFrame: owner.mainFrame };
	const { registerMediaIpc } = await import("./media.js");
	const dispose = registerMediaIpc(owner);
	const api = createSystemApi(
		{
			invoke: async (channel: string, ...args: unknown[]) => state.handlers.get(channel)!(valid, ...args),
		} as IpcRenderer,
		{} as WebUtils,
	).media.customImageProviders;
	const input = {
		name: "My Images",
		baseUrl: "https://images.example/v1",
		model: "image-model",
		supportsTextToImage: true,
		supportsImageToImage: true,
		apiKey: "sk-private",
	};
	try {
		for (const [channel, args] of [
			["vetta:media:custom-image-providers:list", []],
			["vetta:media:custom-image-providers:save", [input]],
			["vetta:media:custom-image-providers:remove", ["id"]],
		] as const) {
			for (const event of [
				{ sender: {}, senderFrame: owner.mainFrame },
				{ sender: owner, senderFrame: {} },
				{ sender: owner, senderFrame: null },
			])
				expect(() => state.handlers.get(channel)!(event, ...args)).toThrow("Untrusted");
			destroyed = true;
			expect(() => state.handlers.get(channel)!(valid, ...args)).toThrow("Untrusted");
			destroyed = false;
		}
		expect(manager.list()).toEqual([]);
		expect(await api.save({ ...input, baseUrl: "file:///tmp/test" })).toEqual({
			ok: false,
			error: "invalid-base-url",
		});
		expect(await api.remove("../path")).toEqual({ ok: false, error: "not-found" });
		const saved = await api.save(input);
		expect(saved).toMatchObject({ ok: true, value: { hasApiKey: true, name: "My Images" } });
		expect(JSON.stringify(await api.list())).not.toContain("sk-private");
		if (!saved.ok) throw new Error("Save failed");
		expect(await api.remove(saved.value.id)).toEqual({ ok: true, value: null });
		expect(await api.list()).toEqual({ ok: true, value: [] });
	} finally {
		dispose();
		manager.dispose();
		artifacts.dispose();
		rmSync(directory, { recursive: true, force: true });
	}
	expect(state.handlers.size).toBe(0);
});
