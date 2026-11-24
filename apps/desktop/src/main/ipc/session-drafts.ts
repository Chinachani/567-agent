import { ipcMain, type WebContents } from "electron";
import { SESSION_DRAFT_CHANNELS, type SessionDraftAppendedEvent } from "../../shared/session-drafts-ipc.js";
import { getDesktopSessionDraftStore } from "../conversations/session-draft-store.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

function requireKey(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 1024) {
		throw new Error("Invalid session draft key");
	}
	return value;
}

function requireText(value: unknown): string {
	if (typeof value !== "string") {
		throw new Error("Invalid session draft text");
	}
	return value;
}

function optionalRevision(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		throw new Error("Invalid session draft revision");
	}
	return value;
}

export function registerSessionDraftsIpc(webContents: WebContents): () => void {
	const store = getDesktopSessionDraftStore();

	ipcMain.handle(SESSION_DRAFT_CHANNELS.LIST, (event) => {
		assertTrustedMainRenderer(event, webContents);
		return store.listDrafts();
	});

	ipcMain.handle(SESSION_DRAFT_CHANNELS.SAVE, (event, key: unknown, text: unknown, expectedRevision: unknown) => {
		assertTrustedMainRenderer(event, webContents);
		store.saveDraft(requireKey(key), requireText(text), optionalRevision(expectedRevision));
	});

	ipcMain.handle(SESSION_DRAFT_CHANNELS.DELETE, (event, key: unknown, expectedRevision: unknown) => {
		assertTrustedMainRenderer(event, webContents);
		store.deleteDraft(requireKey(key), optionalRevision(expectedRevision));
	});

	ipcMain.handle(
		SESSION_DRAFT_CHANNELS.REKEY,
		(event, fromKey: unknown, toKey: unknown, expectedRevision: unknown) => {
			assertTrustedMainRenderer(event, webContents);
			return store.rekeyDraft(requireKey(fromKey), requireKey(toKey), optionalRevision(expectedRevision));
		},
	);

	const unsubscribe = store.onAppended((payload: SessionDraftAppendedEvent) => {
		if (webContents.isDestroyed()) return;
		webContents.send(SESSION_DRAFT_CHANNELS.APPENDED, payload);
	});

	return () => {
		unsubscribe();
		ipcMain.removeHandler(SESSION_DRAFT_CHANNELS.LIST);
		ipcMain.removeHandler(SESSION_DRAFT_CHANNELS.SAVE);
		ipcMain.removeHandler(SESSION_DRAFT_CHANNELS.DELETE);
		ipcMain.removeHandler(SESSION_DRAFT_CHANNELS.REKEY);
	};
}
