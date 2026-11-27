import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IpcRenderer, WebContents } from "electron";
import { expect, it, vi } from "vitest";
import { createSshApi } from "../../preload/apis/ssh.js";
import { SSH_CHANNELS } from "../../shared/ssh-ipc.js";
import { initializeMainMessages } from "../i18n/messages.js";
import { SshHostService } from "../ssh/ssh-host-service.js";
import { createSshHostStore } from "../ssh/ssh-host-store.js";
import { SshPrivateKeyStore } from "../ssh/ssh-private-key.js";
import { registerSshIpc } from "./ssh.js";

const boundary = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	showOpenDialog: vi.fn(),
	getSshHostService: vi.fn(),
}));
vi.mock("electron", () => ({
	BrowserWindow: { fromWebContents: () => ({}) },
	dialog: { showOpenDialog: boundary.showOpenDialog },
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => boundary.handlers.set(channel, handler),
		removeHandler: (channel: string) => boundary.handlers.delete(channel),
	},
}));
vi.mock("../ssh/ssh-host-service-instance.js", () => ({ getSshHostService: boundary.getSshHostService }));
vi.mock("../ssh/ssh-runtime.js", () => ({ getSshHostStatus: () => "disconnected" }));
vi.mock("../credentials/desktop-credential-vault.js", () => ({
	getDesktopCredentialVault: () => ({ remove: () => undefined }),
}));

it("joins the trusted native picker and preload contract without accepting or returning a source path", async () => {
	initializeMainMessages("en");
	const directory = await mkdtemp(join(tmpdir(), "agent567-ssh-ipc-"));
	const owner = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
	const dispose = registerSshIpc(owner as unknown as WebContents);
	try {
		const appHome = join(directory, "home");
		const hostStore = createSshHostStore(join(appHome, "ssh-hosts.json"));
		boundary.getSshHostService.mockReturnValue(
			new SshHostService({
				readHosts: hostStore.read,
				writeHosts: hostStore.write,
				privateKeys: new SshPrivateKeyStore(appHome),
				forgetPassphrase: () => undefined,
				countProjectsOnHost: async () => 0,
				generateId: () => "build-host",
				broadcastChanged: () => undefined,
				invalidateConnection: () => undefined,
			}),
		);
		const source = join(directory, "selected-key");
		const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
		const pem = privateKey.export({ type: "sec1", format: "pem" });
		await writeFile(source, pem);
		boundary.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [source] });
		const invoke = async (channel: string, ...args: unknown[]) =>
			boundary.handlers.get(channel)!({ sender: owner, senderFrame: owner.mainFrame }, ...args);
		const api = createSshApi({ invoke } as IpcRenderer).ssh;
		const subframe = { sender: owner, senderFrame: {} };
		await expect(boundary.handlers.get(SSH_CHANNELS.PICK_PRIVATE_KEY)!(subframe)).rejects.toThrow(
			"Untrusted renderer",
		);
		expect(boundary.showOpenDialog).not.toHaveBeenCalled();
		const input = { label: "Build", target: "build" };
		await expect(api.createHost({ ...input, privateKeyRef: source })).rejects.toThrow("no longer available");

		expect(await invoke(SSH_CHANNELS.PICK_PRIVATE_KEY, "/renderer-supplied-path")).toEqual({
			ref: expect.any(String),
			name: "selected-key",
		});
		const stale = (await api.pickPrivateKey())!;
		owner.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
		await expect(api.createHost({ ...input, privateKeyRef: stale.ref })).rejects.toThrow("no longer available");
		await expect(stat(appHome)).rejects.toMatchObject({ code: "ENOENT" });
		const selected = (await api.pickPrivateKey())!;
		const saved = await api.createHost({ ...input, privateKeyRef: selected.ref });
		expect(saved).not.toHaveProperty("managedIdentityId");
		expect(saved.identityFile).not.toBe(source);
		expect((await readFile(saved.identityFile!)).equals(Buffer.from(pem))).toBe(true);
	} finally {
		dispose();
		await rm(directory, { recursive: true, force: true });
	}
	expect(owner.listenerCount("did-start-navigation")).toBe(0);
});
