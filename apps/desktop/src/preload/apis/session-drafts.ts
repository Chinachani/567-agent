import type { IpcRenderer, IpcRendererEvent } from "electron";
import { SESSION_DRAFT_CHANNELS, type SessionDraftAppendedEvent } from "../../shared/session-drafts-ipc.js";
import type { DesktopApi } from "../api.js";

export function createSessionDraftsApi(ipc: IpcRenderer): Pick<DesktopApi, "sessionDrafts"> {
	return {
		sessionDrafts: {
			list: () => ipc.invoke(SESSION_DRAFT_CHANNELS.LIST),
			save: (key, text, expectedRevision) => ipc.invoke(SESSION_DRAFT_CHANNELS.SAVE, key, text, expectedRevision),
			remove: (key, expectedRevision) => ipc.invoke(SESSION_DRAFT_CHANNELS.DELETE, key, expectedRevision),
			rekey: (fromKey, toKey, expectedRevision) =>
				ipc.invoke(SESSION_DRAFT_CHANNELS.REKEY, fromKey, toKey, expectedRevision),
			onAppended: (listener) => {
				const handler = (_event: IpcRendererEvent, payload: SessionDraftAppendedEvent): void => listener(payload);
				ipc.on(SESSION_DRAFT_CHANNELS.APPENDED, handler);
				return () => ipc.removeListener(SESSION_DRAFT_CHANNELS.APPENDED, handler);
			},
		},
	};
}
