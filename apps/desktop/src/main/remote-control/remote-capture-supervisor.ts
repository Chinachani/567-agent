import { type ChildProcess, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { decodeRemoteInputMessage } from "@567agent/remote-desktop";
import { app, dialog } from "electron";
import { z } from "zod";
import { getApplicationCacheService } from "../cache/application-cache-service.js";
import { getAppLanguage } from "../i18n/index.js";
import { getAppLogger } from "../logger.js";
import type { DesktopRemoteDesktopHostHandle, DesktopRemoteDesktopHostOptions } from "./desktop-remote-desktop-host.js";
import {
	REMOTE_CAPTURE_HELPER_SWITCH,
	REMOTE_CAPTURE_PROFILE_ENV,
	RemoteCaptureChannel,
} from "./remote-capture-channel.js";
import {
	type CaptureInputState,
	captureCapabilitySchema,
	captureDialogSchema,
	captureTargetSchema,
} from "./remote-capture-contract.js";
import { createSystemInputAdapter } from "./system-input.js";

const log = getAppLogger("remote-capture-supervisor");
const startedSchema = z.object({ sessionId: z.string().min(1).max(256) });
const RESTART_WINDOW_MS = 300_000;

interface CaptureChild {
	process: ChildProcess;
	channel: RemoteCaptureChannel;
	profile: string;
	abort: AbortController;
	exited: Promise<void>;
}

export async function startIsolatedRemoteCapture(
	options: DesktopRemoteDesktopHostOptions,
): Promise<DesktopRemoteDesktopHostHandle> {
	const input = createSystemInputAdapter({ enabled: false, waylandTokens: options.waylandInputTokens });
	const cache = getApplicationCacheService().namespace("remote-capture");
	let child: CaptureChild | undefined;
	let stopped = false;
	let wantsInput = false;
	let inputGeneration = 0;
	let autoShareScreen = options.autoShareScreen === true;
	let capability: z.infer<typeof captureCapabilitySchema> = {
		supported: false,
		reason: "capture_source_not_selected",
	};
	let restartTimer: ReturnType<typeof setTimeout> | undefined;
	let lastRestart = 0;
	let sessionId = "";
	const snapshot = (): CaptureInputState => ({
		supported: input.supported,
		granted: wantsInput && (input.granted ?? true),
		pointerMode: input.pointerMode ?? "absolute",
		reason: input.unsupportedReason,
	});
	const sendInputState = () => child?.channel.event("input-state", snapshot());
	const disableInput = () => {
		inputGeneration += 1;
		wantsInput = false;
		try {
			void Promise.resolve(input.setEnabled(false)).catch(() => log.warn("capture input revocation failed"));
		} catch {
			log.warn("capture input revocation failed");
		}
		sendInputState();
	};
	const unsubscribe = input.onGrantedChange?.(sendInputState);
	const revokeCapture = () => {
		disableInput();
		input.setCaptureTarget?.(undefined);
		capability = { supported: false, reason: "capture_source_not_selected" };
		options.onInputCapabilityChange?.(false, capability.reason);
	};

	const stopChild = async (current: CaptureChild): Promise<void> => {
		current.abort.abort();
		current.channel.event("stop", null);
		current.channel.close();
		const killTimer = setTimeout(() => current.process.kill("SIGKILL"), 2000);
		try {
			await current.exited;
		} finally {
			clearTimeout(killTimer);
		}
	};

	const launch = async (): Promise<void> => {
		const profile = await cache.createTemporaryDirectory("host");
		if (stopped) {
			await rm(profile, { recursive: true, force: true });
			return;
		}
		const targets = options.signalingTargets ?? [
			options.signalingTarget ?? `${options.signalingUrl}#${options.pairingToken}`,
		];
		const env: NodeJS.ProcessEnv = { ...process.env, [REMOTE_CAPTURE_PROFILE_ENV]: profile };
		delete env.ELECTRON_RUN_AS_NODE;
		delete env.NODE_OPTIONS;
		// A packaged Electron always starts its app entry. bootstrap.ts routes the
		// helper flag before loading main.ts. Development needs the built entry too.
		const args = [
			`--user-data-dir=${profile}`,
			REMOTE_CAPTURE_HELPER_SWITCH,
			...(app.isPackaged ? [] : [join(options.appRoot, "dist/main/index.js")]),
		];
		let processChild: ChildProcess;
		try {
			processChild = spawn(process.execPath, args, { env, stdio: ["ignore", "ignore", "ignore", "ipc"] });
		} catch (error) {
			await rm(profile, { recursive: true, force: true });
			throw error;
		}
		const channel = new RemoteCaptureChannel((value) => {
			if (!processChild.connected) throw new Error("Capture helper disconnected");
			processChild.send(value, (error) => {
				if (error) processChild.kill("SIGKILL");
			});
		});
		let resolveExit!: () => void;
		const exited = new Promise<void>((resolve) => {
			resolveExit = resolve;
		});
		const current: CaptureChild = { process: processChild, channel, profile, abort: new AbortController(), exited };
		child = current;
		let initialized = false;
		let resolveStart!: () => void;
		let rejectStart!: (error: Error) => void;
		const ready = new Promise<void>((resolve, reject) => {
			resolveStart = resolve;
			rejectStart = reject;
		});
		const startupTimer = setTimeout(() => {
			rejectStart(new Error("Capture helper startup timed out"));
			processChild.kill("SIGKILL");
		}, 30_000);
		const isCurrent = () => !stopped && child === current && !current.abort.signal.aborted;

		channel.onRequest = async (method, value) => {
			if (!isCurrent()) throw new Error("Expired capture process");
			if (method === "dialog") {
				const prompt = captureDialogSchema.parse(value);
				const { getMainWindow } = await import("../window-manager.js");
				if (!isCurrent()) throw new Error("Expired capture dialog");
				const parent = getMainWindow();
				const config = { ...prompt, signal: current.abort.signal };
				return parent && !parent.isDestroyed() && parent.isVisible()
					? dialog.showMessageBox(parent, config)
					: dialog.showMessageBox(config);
			}
			if (method === "enable-input") {
				if (!wantsInput || !capability.supported) throw new Error("Input not granted by main process");
				const generation = inputGeneration;
				await input.setEnabled(true);
				if (!isCurrent() || generation !== inputGeneration || !wantsInput) throw new Error("Expired input grant");
				sendInputState();
				return snapshot();
			}
			if (method === "remember-screen" && typeof value === "boolean") {
				autoShareScreen = value;
				await options.onAutoShareScreenChange?.(value);
				return null;
			}
			throw new Error("Unsupported capture request");
		};
		channel.onEvent = (method, value) => {
			if (!isCurrent()) return;
			if (method === "booted" && !initialized) {
				initialized = true;
				void channel
					.request("initialize", {
						signalingTargets: targets,
						appRoot: options.appRoot,
						isPackaged: options.isPackaged,
						devServerUrl: options.devServerUrl,
						autoShareScreen,
						language: getAppLanguage(),
						input: snapshot(),
					})
					.then((result) => {
						sessionId = startedSchema.parse(result).sessionId;
						resolveStart();
					}, rejectStart)
					.catch(() => rejectStart(new Error("Invalid capture helper state")));
			} else if (method === "capability") {
				const parsed = captureCapabilitySchema.safeParse(value);
				if (!parsed.success) return;
				capability = parsed.data;
				if (!capability.supported) disableInput();
				options.onInputCapabilityChange?.(capability.supported, capability.reason);
			} else if (method === "capture-target") {
				const parsed = captureTargetSchema.safeParse(value);
				if (!parsed.success) return;
				input.setCaptureTarget?.(parsed.data ?? undefined);
				sendInputState();
			} else if (method === "disable-input") disableInput();
			else if (method === "input" && wantsInput && capability.supported) {
				try {
					input.apply(decodeRemoteInputMessage(value));
				} catch {
					log.warn("invalid isolated capture input rejected");
				}
			}
		};
		processChild.on("message", (value: unknown) => channel.receive(value));
		let ended = false;
		const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
			if (ended) return;
			ended = true;
			clearTimeout(startupTimer);
			current.abort.abort();
			channel.close();
			rejectStart(new Error("Capture helper exited"));
			resolveExit();
			void rm(profile, { recursive: true, force: true }).catch(() => log.warn("capture profile cleanup failed"));
			if (child !== current) return;
			child = undefined;
			if (stopped) return;
			revokeCapture();
			log.warn("isolated capture exited; main application retained", { code, signal });
			// A fresh capture must be approved again after a native crash. Permit
			// one recovery per five minutes, never a fast crash/respawn loop.
			autoShareScreen = false;
			if (Date.now() - lastRestart < RESTART_WINDOW_MS) return;
			lastRestart = Date.now();
			restartTimer = setTimeout(() => {
				restartTimer = undefined;
				if (!stopped) void launch().catch(() => log.warn("capture recovery unavailable"));
			}, 1000);
		};
		processChild.once("exit", onExit);
		processChild.once("close", onExit);
		processChild.on("error", () => {
			current.abort.abort();
			channel.close();
			rejectStart(new Error("Capture helper process failed"));
			if (child === current && !stopped) revokeCapture();
		});
		processChild.once("disconnect", () => {
			current.abort.abort();
			channel.close();
			if (child === current) revokeCapture();
			processChild.kill("SIGKILL");
		});
		try {
			await ready;
		} catch (error) {
			await stopChild(current);
			throw error;
		} finally {
			clearTimeout(startupTimer);
		}
	};

	const stop = async () => {
		if (stopped) return;
		stopped = true;
		if (restartTimer) clearTimeout(restartTimer);
		unsubscribe?.();
		revokeCapture();
		const current = child;
		if (current) await stopChild(current);
	};
	try {
		await launch();
	} catch (error) {
		await stop();
		throw error;
	}
	return {
		get sessionId() {
			return sessionId;
		},
		get inputSupported() {
			return input.supported && capability.supported && Boolean(child);
		},
		get inputGranted() {
			return Boolean(child) && snapshot().granted;
		},
		get inputPointerMode() {
			return input.pointerMode ?? "absolute";
		},
		get inputSupportReason() {
			return input.unsupportedReason ?? capability.reason;
		},
		revokeInput() {
			disableInput();
			child?.channel.event("revoke-input", null);
		},
		async grantInput() {
			const current = child;
			if (stopped || !current || !capability.supported) return;
			wantsInput = true;
			const generation = ++inputGeneration;
			try {
				await current.channel.request("grant-input", null, 300_000);
			} catch (error) {
				if (child !== current || generation !== inputGeneration || stopped) return;
				disableInput();
				throw error;
			}
		},
		setAutoShareScreen(enabled) {
			autoShareScreen = enabled;
			child?.channel.event("auto-share", enabled);
		},
		stop,
	};
}
