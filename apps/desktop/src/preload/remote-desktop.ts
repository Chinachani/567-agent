import { contextBridge, ipcRenderer } from "electron";

const remoteDesktopApi = {
	requestCapture(routeIndex: number): void {
		ipcRenderer.send("vetta:remote-desktop:request-capture", routeIndex);
	},
	onInput(message: unknown): void {
		ipcRenderer.send("vetta:remote-desktop:input", message);
	},
};

contextBridge.exposeInMainWorld("vettaRemoteDesktop", remoteDesktopApi);
contextBridge.exposeInMainWorld("agent567RemoteDesktop", remoteDesktopApi);
