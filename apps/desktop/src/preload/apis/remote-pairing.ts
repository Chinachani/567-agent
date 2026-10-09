import type { IpcRenderer } from "electron";
import type { RemotePairingApi } from "../api-types/remote-pairing.js";

export function createRemotePairingApi(ipc: Pick<IpcRenderer, "invoke">): RemotePairingApi {
	return {
		getState: () => ipc.invoke("vetta:remote-pairing:get-state"),
		create: (relayBaseUrl) => ipc.invoke("vetta:remote-pairing:create", relayBaseUrl),
		resetCertificate: (relayBaseUrl) => ipc.invoke("vetta:remote-pairing:reset-certificate", relayBaseUrl),
		setAutoShareScreen: (enabled) => ipc.invoke("vetta:remote-pairing:set-auto-share-screen", enabled),
		setInputEnabled: (enabled) => ipc.invoke("vetta:remote-pairing:set-input-enabled", enabled),
		installInputDependencies: () => ipc.invoke("vetta:remote-pairing:install-input-dependencies"),
		revoke: () => ipc.invoke("vetta:remote-pairing:revoke"),
	};
}
