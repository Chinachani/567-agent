import { app } from "electron";
import {
	type DesktopRemoteDesktopHostHandle,
	type DesktopRemoteDesktopHostOptions,
	startDesktopRemoteDesktopHost as startInProcessHost,
	stopDesktopRemoteDesktopHost as stopInProcessHost,
} from "./desktop-remote-desktop-host.js";
import { startIsolatedRemoteCapture } from "./remote-capture-supervisor.js";

export type { DesktopRemoteDesktopHostHandle, DesktopRemoteDesktopHostOptions } from "./desktop-remote-desktop-host.js";

let active: DesktopRemoteDesktopHostHandle | undefined;
let starting: Promise<DesktopRemoteDesktopHostHandle> | undefined;

/** Keep the public pairing handle stable while Linux native capture lives elsewhere. */
export function startDesktopRemoteDesktopHost(
	options: DesktopRemoteDesktopHostOptions,
): Promise<DesktopRemoteDesktopHostHandle> {
	if (active) return Promise.resolve(active);
	if (starting) return starting;
	starting = (process.platform === "linux" ? startIsolatedRemoteCapture(options) : startInProcessHost(options))
		.then((host) => {
			const handle: DesktopRemoteDesktopHostHandle = {
				get sessionId() {
					return host.sessionId;
				},
				get inputSupported() {
					return host.inputSupported;
				},
				get inputGranted() {
					return host.inputGranted;
				},
				get inputPointerMode() {
					return host.inputPointerMode;
				},
				get inputSupportReason() {
					return host.inputSupportReason;
				},
				revokeInput: () => host.revokeInput(),
				grantInput: () => host.grantInput(),
				setAutoShareScreen: (enabled) => host.setAutoShareScreen(enabled),
				async stop() {
					if (active === handle) active = undefined;
					await host.stop();
				},
			};
			active = handle;
			return handle;
		})
		.finally(() => {
			starting = undefined;
		});
	return starting;
}

export async function stopDesktopRemoteDesktopHost(): Promise<void> {
	const pending = starting;
	if (pending) await pending.catch(() => undefined);
	const host = active;
	active = undefined;
	await host?.stop();
	if (process.platform !== "linux") await stopInProcessHost();
}

// A shutdown during startup must also terminate the capture child and its IPC pipe.
app.on("before-quit", () => {
	void stopDesktopRemoteDesktopHost();
});
