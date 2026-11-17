import { isAbsolute } from "node:path";
import { isSshProjectUri } from "@567agent/ssh-transport";
import { type IpcMainInvokeEvent, ipcMain, type WebContents } from "electron";
import { clampTerminalSize, type OpenTerminalRequest, TERMINAL_CHANNELS } from "../../shared/terminal-ipc.js";
import { TerminalOwner } from "../terminal/terminal-owner.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

function requireString(value: unknown, field: string, max = 8192): string {
	if (typeof value !== "string" || value.length === 0 || value.length > max || value.includes("\0"))
		throw new Error(`terminal: invalid ${field}`);
	return value;
}
function parseOpenRequest(value: unknown): OpenTerminalRequest {
	if (!value || typeof value !== "object") throw new Error("terminal: invalid request");
	const input = value as Record<string, unknown>;
	const cwd = requireString(input.cwd, "cwd");
	if (!isAbsolute(cwd) && !isSshProjectUri(cwd)) throw new Error("terminal: cwd must be absolute");
	if (typeof input.cols !== "number" || typeof input.rows !== "number") throw new Error("terminal: invalid size");
	return { cwd, ...clampTerminalSize(input.cols, input.rows) };
}
export function registerTerminalIpc(owner: WebContents): () => void {
	const terminals = new TerminalOwner(owner);
	const handle = (channel: string, handler: (...args: unknown[]) => unknown) =>
		ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
			assertTrustedMainRenderer(event, owner);
			return handler(...args);
		});
	handle(TERMINAL_CHANNELS.CAPABILITIES, () => terminals.service.capabilities());
	handle(TERMINAL_CHANNELS.OPEN, (request) => terminals.open(parseOpenRequest(request)));
	handle(TERMINAL_CHANNELS.ATTACH, (id) => terminals.attach(requireString(id, "terminalId", 128)));
	handle(TERMINAL_CHANNELS.WRITE, (id, data) => {
		if (typeof data !== "string" || data.length > 1024 * 1024) throw new Error("terminal: invalid input");
		terminals.service.get(requireString(id, "terminalId", 128))?.write(data);
	});
	handle(TERMINAL_CHANNELS.RESIZE, (id, cols, rows) => {
		if (typeof cols !== "number" || typeof rows !== "number") throw new Error("terminal: invalid size");
		const size = clampTerminalSize(cols, rows);
		terminals.service.get(requireString(id, "terminalId", 128))?.resize(size.cols, size.rows);
	});
	handle(TERMINAL_CHANNELS.CLOSE, (id) => terminals.close(requireString(id, "terminalId", 128)));
	handle(
		TERMINAL_CHANNELS.FOREGROUND,
		(id) => terminals.service.get(requireString(id, "terminalId", 128))?.foregroundProcess() ?? null,
	);
	handle(TERMINAL_CHANNELS.SNAPSHOT_SAVE, (id, text) => {
		if (typeof text !== "string" || text.length > 4 * 1024 * 1024) throw new Error("terminal: invalid snapshot");
		return terminals.snapshots.save(requireString(id, "tabId", 128), text);
	});
	handle(
		TERMINAL_CHANNELS.SNAPSHOT_LOAD,
		async (id) => (await terminals.snapshots.load(requireString(id, "tabId", 128))) ?? null,
	);
	return () => {
		for (const channel of Object.values(TERMINAL_CHANNELS))
			if (channel !== TERMINAL_CHANNELS.EVENT) ipcMain.removeHandler(channel);
		terminals.dispose();
	};
}
