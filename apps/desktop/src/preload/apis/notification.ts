import type { IpcRenderer } from "electron";
import { RESULT_INBOX_CHANNELS } from "../../shared/result-inbox.js";
import type { DesktopApi } from "../api.js";
import { onIpcEvent } from "./helper.js";

const NOTIFICATION_CHANNELS = {
	SET_FOREGROUND: "vetta:notification:set-foreground-session",
	NAVIGATE: "vetta:notification:navigate",
} as const;

export function createNotificationApi(ipc: IpcRenderer): Pick<DesktopApi, "notification"> {
	return {
		notification: {
			listResults: () => ipc.invoke(RESULT_INBOX_CHANNELS.LIST),
			markResultRead: (key) => ipc.invoke(RESULT_INBOX_CHANNELS.READ, key),
			setForegroundSession: (sessionPath) => ipc.invoke(NOTIFICATION_CHANNELS.SET_FOREGROUND, sessionPath),
			onNavigate: (handler) => onIpcEvent(ipc, NOTIFICATION_CHANNELS.NAVIGATE, handler),
		},
	};
}
