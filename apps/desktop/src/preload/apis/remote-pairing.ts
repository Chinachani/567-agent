import type { IpcRenderer } from "electron";
import { REMOTE_PAIRING_CHANNELS } from "../../shared/remote-pairing-ipc.js";
import type { RemotePairingApi } from "../api-types/remote-pairing.js";

export function createRemotePairingApi(ipc: Pick<IpcRenderer, "invoke">): RemotePairingApi {
	return {
		getState: () => ipc.invoke(REMOTE_PAIRING_CHANNELS.getState),
		create: (relayBaseUrl) => ipc.invoke(REMOTE_PAIRING_CHANNELS.create, relayBaseUrl),
		resetCertificate: (relayBaseUrl) => ipc.invoke(REMOTE_PAIRING_CHANNELS.resetCertificate, relayBaseUrl),
		setAutoShareScreen: (enabled) => ipc.invoke(REMOTE_PAIRING_CHANNELS.setAutoShareScreen, enabled),
		setInputEnabled: (enabled) => ipc.invoke(REMOTE_PAIRING_CHANNELS.setInputEnabled, enabled),
		installInputDependencies: () => ipc.invoke(REMOTE_PAIRING_CHANNELS.installInputDependencies),
		revoke: () => ipc.invoke(REMOTE_PAIRING_CHANNELS.revoke),
	};
}
