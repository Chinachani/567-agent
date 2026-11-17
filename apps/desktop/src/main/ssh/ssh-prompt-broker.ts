import { randomUUID } from "node:crypto";
import { ipcMain, type WebContents } from "electron";
import {
	SSH_PROMPT_CHANNELS,
	type SshPromptRequestEvent,
	type SshPromptResponse,
} from "../../shared/ssh-prompt-ipc.js";
import type { SshPromptUserAnswer, SshPromptUserRequest } from "./ssh-prompt-service.js";

/** 一次提示最多等多久。超过就当用户没在看，让 ssh 放弃本次认证而不是无限挂着。 */
const PROMPT_TIMEOUT_MS = 3 * 60 * 1000;

interface PendingPrompt {
	resolve: (answer: SshPromptUserAnswer) => void;
	owner: WebContents;
	timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingPrompt>();
let registered = false;

/**
 * 把提示送到渲染进程并等用户回答。
 *
 * 超时和窗口全关都按「拒绝」处理：确认类提示绝不能因为没人应答就变成默认同意。
 */
export async function askSshPromptInRenderer(request: SshPromptUserRequest): Promise<SshPromptUserAnswer> {
	ensureRegistered();
	const { getMainWindow } = await import("../window-manager.js");
	const window = getMainWindow();
	if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return Promise.resolve({ ok: false });

	const owner = window.webContents;
	const id = randomUUID();
	const event: SshPromptRequestEvent = {
		id,
		hostId: request.hostId,
		hostLabel: request.hostLabel,
		kind: request.kind,
		prompt: request.prompt,
		rememberable: request.rememberable,
	};

	return new Promise<SshPromptUserAnswer>((resolve) => {
		const settle = (answer: SshPromptUserAnswer): void => {
			const entry = pending.get(id);
			if (!entry) return;
			pending.delete(id);
			clearTimeout(entry.timer);
			owner.removeListener("destroyed", onDestroyed);
			owner.removeListener("did-navigate", onDestroyed);
			owner.removeListener("render-process-gone", onDestroyed);
			try {
				if (!owner.isDestroyed()) owner.send(SSH_PROMPT_CHANNELS.CANCEL, id);
			} catch {
				/* Owner may have closed. */
			}
			resolve(answer);
		};
		const onDestroyed = () => settle({ ok: false });
		owner.once("destroyed", onDestroyed);
		owner.once("did-navigate", onDestroyed);
		owner.once("render-process-gone", onDestroyed);
		const timer = setTimeout(() => settle({ ok: false }), PROMPT_TIMEOUT_MS);
		timer.unref?.();
		pending.set(id, { resolve: settle, timer, owner });
		try {
			owner.send(SSH_PROMPT_CHANNELS.REQUEST, event);
		} catch {
			settle({ ok: false });
		}
	});
}

function ensureRegistered(): void {
	if (registered) return;
	registered = true;
	ipcMain.on(SSH_PROMPT_CHANNELS.RESPOND, (event, payload: unknown) => {
		const response = payload as Partial<SshPromptResponse> | undefined;
		if (!response || typeof response.id !== "string") return;
		const entry = pending.get(response.id);
		if (
			!entry ||
			entry.owner.isDestroyed() ||
			event.sender !== entry.owner ||
			!event.senderFrame ||
			event.senderFrame !== entry.owner.mainFrame
		)
			return;
		entry.resolve({
			ok: response.ok === true,
			...(typeof response.value === "string" ? { value: response.value } : {}),
			...(response.remember === true ? { remember: true } : {}),
		});
	});
}
