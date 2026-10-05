import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vettaRemoteDesktop", {
	requestCapture(routeIndex: number): void {
		ipcRenderer.send("vetta:remote-desktop:request-capture", routeIndex);
	},
	onInput(message: unknown): void {
		ipcRenderer.send("vetta:remote-desktop:input", message);
	},
});
