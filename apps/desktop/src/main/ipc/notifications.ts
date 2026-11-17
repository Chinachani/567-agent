import { ipcMain, type WebContents } from "electron";
import { z } from "zod";
import { RESULT_INBOX_CHANNELS } from "../../shared/result-inbox.js";
import { registerNotificationIpc as registerSystemNotifications } from "../notifications/index.js";
import { listResultInbox, markResultRead } from "../result-inbox/result-inbox-service.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

export function registerNotificationIpc(owner: WebContents): () => void {
	const teardown = registerSystemNotifications(owner);
	ipcMain.handle(RESULT_INBOX_CHANNELS.LIST, (event) => {
		assertTrustedMainRenderer(event, owner);
		return listResultInbox();
	});
	ipcMain.handle(RESULT_INBOX_CHANNELS.READ, (event, key: unknown) => {
		assertTrustedMainRenderer(event, owner);
		return markResultRead(
			z
				.string()
				.regex(/^[a-f0-9]{64}$/)
				.parse(key),
		);
	});
	return () => {
		ipcMain.removeHandler(RESULT_INBOX_CHANNELS.LIST);
		ipcMain.removeHandler(RESULT_INBOX_CHANNELS.READ);
		teardown();
	};
}
