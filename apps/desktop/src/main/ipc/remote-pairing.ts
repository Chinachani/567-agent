import { ipcMain } from "electron";
import { REMOTE_PAIRING_CHANNELS } from "../../shared/remote-pairing-ipc.js";
import type { DesktopRemotePairingService } from "../remote-control/desktop-remote-pairing-service.js";
import { installLinuxInputDependencies } from "../remote-control/install-linux-input-dependencies.js";

export function registerRemotePairingIpc(service: DesktopRemotePairingService): () => void {
	const run = async (operation: () => Promise<ReturnType<typeof service.getState>>) => {
		try {
			return await operation();
		} catch (error) {
			return service.reportOperationError(error);
		}
	};
	ipcMain.handle(REMOTE_PAIRING_CHANNELS.getState, () => service.getState());
	ipcMain.handle(REMOTE_PAIRING_CHANNELS.create, (_event, relayBaseUrl: unknown) =>
		run(() => service.create(typeof relayBaseUrl === "string" ? relayBaseUrl : undefined)),
	);
	ipcMain.handle(REMOTE_PAIRING_CHANNELS.resetCertificate, (_event, relayBaseUrl: unknown) =>
		run(() => service.resetCertificate(typeof relayBaseUrl === "string" ? relayBaseUrl : undefined)),
	);
	ipcMain.handle(REMOTE_PAIRING_CHANNELS.setAutoShareScreen, (_event, enabled: unknown) =>
		run(() => service.setAutoShareScreen(enabled === true)),
	);
	ipcMain.handle(REMOTE_PAIRING_CHANNELS.setInputEnabled, (_event, enabled: unknown) =>
		run(() => service.setInputEnabled(enabled === true)),
	);
	ipcMain.handle(REMOTE_PAIRING_CHANNELS.installInputDependencies, () => installLinuxInputDependencies());
	ipcMain.handle(REMOTE_PAIRING_CHANNELS.revoke, () =>
		run(async () => {
			await service.revoke();
			return service.getState();
		}),
	);
	return () => {
		for (const channel of Object.values(REMOTE_PAIRING_CHANNELS)) ipcMain.removeHandler(channel);
	};
}
