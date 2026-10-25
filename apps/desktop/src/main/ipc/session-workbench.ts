import { ipcMain, type WebContents } from "electron";
import { SESSION_WORKBENCH_CHANNELS } from "../../shared/session-workbench-ipc.js";
import { getDesktopConversationService } from "../conversations/desktop-conversation-service.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid ${field}`);
}
export function registerSessionWorkbenchIpc(owner: WebContents): () => void {
	ipcMain.handle(SESSION_WORKBENCH_CHANNELS.WORKBENCH, (event, sessionId: unknown) => {
		assertTrustedMainRenderer(event, owner);
		assertNonEmptyString(sessionId, "sessionId");
		return getDesktopConversationService().readSessionWorkbench(sessionId);
	});
	ipcMain.handle(
		SESSION_WORKBENCH_CHANNELS.WORKBENCH_DETAIL,
		(event, sessionId: unknown, kind: unknown, id: unknown) => {
			assertTrustedMainRenderer(event, owner);
			assertNonEmptyString(sessionId, "sessionId");
			assertNonEmptyString(kind, "kind");
			assertNonEmptyString(id, "id");
			return getDesktopConversationService().readSessionWorkbenchDetail(sessionId, kind, id);
		},
	);
	ipcMain.handle(
		SESSION_WORKBENCH_CHANNELS.ATTACHMENT_READ,
		(event, sessionId: unknown, id: unknown, offset: unknown, length: unknown) => {
			assertTrustedMainRenderer(event, owner);
			assertNonEmptyString(sessionId, "sessionId");
			assertNonEmptyString(id, "id");
			if (typeof offset !== "number" || typeof length !== "number") throw new Error("Invalid chunk range");
			return getDesktopConversationService().readSessionAttachmentChunk(sessionId, id, offset, length);
		},
	);
	ipcMain.handle(
		SESSION_WORKBENCH_CHANNELS.REVIEW_CHANGE,
		(event, sessionId: unknown, id: unknown, action: unknown, revision: unknown) => {
			assertTrustedMainRenderer(event, owner);
			assertNonEmptyString(sessionId, "sessionId");
			assertNonEmptyString(id, "id");
			assertNonEmptyString(action, "action");
			if (typeof revision !== "string") throw new Error("Invalid file revision");
			return getDesktopConversationService().reviewSessionChange(sessionId, id, action, revision);
		},
	);
	ipcMain.handle(SESSION_WORKBENCH_CHANNELS.CONTEXT_WORKSPACE, (event, sessionId: unknown) => {
		assertTrustedMainRenderer(event, owner);
		assertNonEmptyString(sessionId, "sessionId");
		return getDesktopConversationService().readContextWorkspace(sessionId);
	});
	ipcMain.handle(SESSION_WORKBENCH_CHANNELS.CONTEXT_SELECTION, (event, sessionId: unknown, selection: unknown) => {
		assertTrustedMainRenderer(event, owner);
		assertNonEmptyString(sessionId, "sessionId");
		return getDesktopConversationService().updateContextSelection(sessionId, selection);
	});
	return () => {
		for (const channel of Object.values(SESSION_WORKBENCH_CHANNELS)) ipcMain.removeHandler(channel);
	};
}
