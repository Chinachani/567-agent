import { decodeRemoteInputMessage } from "@567agent/remote-desktop";
import { app } from "electron";
import { initializeMainMessages } from "../i18n/messages.js";
import { type DesktopRemoteDesktopHostHandle, startDesktopRemoteDesktopHost } from "./desktop-remote-desktop-host.js";
import { RemoteCaptureChannel } from "./remote-capture-channel.js";
import {
	type CaptureInputState,
	captureDialogResultSchema,
	captureInitializationSchema,
	captureInputStateSchema,
} from "./remote-capture-contract.js";
import type { SystemInputAdapter } from "./system-input.js";

/** This process owns capture only: no GUI lock, runtime, credential vault or main profile. */
export function runRemoteCaptureHelper(): void {
	if (!process.send) throw new Error("Missing capture parent channel");
	const channel = new RemoteCaptureChannel((value) => {
		if (!process.connected || !process.send) throw new Error("Capture parent disconnected");
		process.send(value, (error) => {
			if (error) app.exit(1);
		});
	});
	let host: DesktopRemoteDesktopHostHandle | undefined;
	let initializing = false;
	let state: CaptureInputState = { supported: false, granted: false, pointerMode: "relative" };
	const listeners = new Set<(granted: boolean) => void>();
	const input: SystemInputAdapter = {
		get supported() {
			return state.supported;
		},
		get granted() {
			return state.granted;
		},
		get pointerMode() {
			return state.pointerMode;
		},
		get unsupportedReason() {
			return state.reason;
		},
		setCaptureTarget(target) {
			channel.event("capture-target", target ?? null);
		},
		onGrantedChange(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		setEnabled(enabled) {
			if (!enabled) {
				channel.event("disable-input", null);
				return;
			}
			return channel.request("enable-input", null, 300_000).then((value) => {
				state = captureInputStateSchema.parse(value);
				for (const listener of listeners) listener(state.granted);
			});
		},
		apply(message) {
			channel.event("input", decodeRemoteInputMessage(message));
		},
	};
	channel.onRequest = async (method, value) => {
		if (method === "initialize" && !initializing) {
			initializing = true;
			const init = captureInitializationSchema.parse(value);
			state = init.input;
			initializeMainMessages(init.language);
			await app.whenReady();
			host = await startDesktopRemoteDesktopHost(
				{
					...init,
					inputEnabled: false,
					onAutoShareScreenChange: async (enabled) => {
						await channel.request("remember-screen", enabled);
					},
					onInputCapabilityChange: (supported, reason) => {
						channel.event("capability", { supported, reason });
					},
				},
				{
					input,
					showDialog: async (options) =>
						captureDialogResultSchema.parse(await channel.request("dialog", options, 300_000)),
				},
			);
			return { sessionId: host.sessionId };
		}
		if (method === "grant-input" && host) {
			await host.grantInput();
			return null;
		}
		throw new Error("Unsupported capture command");
	};
	channel.onEvent = (method, value) => {
		if (method === "input-state") {
			const parsed = captureInputStateSchema.safeParse(value);
			if (!parsed.success) return;
			state = parsed.data;
			for (const listener of listeners) listener(state.granted);
		} else if (method === "revoke-input") host?.revokeInput();
		else if (method === "auto-share" && typeof value === "boolean") host?.setAutoShareScreen(value);
		else if (method === "stop") {
			void host?.stop().finally(() => app.exit(0));
			if (!host) app.exit(0);
		}
	};
	process.on("message", (value: unknown) => channel.receive(value));
	process.once("disconnect", () => {
		channel.close();
		app.exit(0);
	});
	process.once("SIGTERM", () => {
		app.exit(0);
	});
	// Keep the hidden host alive, but never survive the authenticated parent pipe.
	app.on("window-all-closed", () => {});
	// Do not await ready from the awaited ESM bootstrap: Electron must finish
	// evaluating that entry before it can emit ready.
	void app.whenReady().then(() => channel.event("booted", null));
}
