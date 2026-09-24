import type { IpcRenderer } from "electron";
import type { Api567Api, Api567Status } from "../api-types/567api.js";
import { onIpcEvent } from "./helper.js";

export function create567Api(ipc: IpcRenderer): { api567: Api567Api } {
	return {
		api567: {
			getStatus: () => ipc.invoke("vetta:567api:get-status"),
			getAvailableGroups: (force?: boolean) => ipc.invoke("vetta:567api:get-groups", force),
			syncGroup: (groupName: string) => ipc.invoke("vetta:567api:sync-group", groupName),
			removeGroup: (groupName: string) => ipc.invoke("vetta:567api:remove-group", groupName),
			setActiveGroup: (groupName: string) => ipc.invoke("vetta:567api:set-active-group", groupName),
			setImageGroup: (groupName: string) => ipc.invoke("vetta:567api:set-image-group", groupName),
			setImageModel: (modelName: string) => ipc.invoke("vetta:567api:set-image-model", modelName),
			loginWithAccessToken: (token: string) => ipc.invoke("vetta:567api:login-access-token", token),
			loginWithPassword: (credentials) =>
				ipc.invoke("vetta:567api:login-password", credentials.username, credentials.password),
			login: (credentials) => ipc.invoke("vetta:567api:login-password", credentials.username, credentials.password),
			bindToken: (token) => ipc.invoke("vetta:567api:login-access-token", token),
			refreshQuota: (force?: boolean) => ipc.invoke("vetta:567api:refresh-quota", force),
			refreshGroups: () => ipc.invoke("vetta:567api:refresh-groups"),
			logout: () => ipc.invoke("vetta:567api:logout"),
			onStatusChanged: (handler: (status: Api567Status) => void) =>
				onIpcEvent(ipc, "vetta:567api:status-changed", handler),
		},
	};
}
