import { randomUUID } from "node:crypto";
import type { RemoteInputMessage } from "@567agent/remote-desktop";
import { type ClientInterface, Message, type MessageBus, sessionBus, Variant } from "dbus-next";
import { getAppLogger } from "../logger.js";
import type { SystemInputAdapter } from "./system-input.js";
import { waylandKeycode } from "./wayland-keycode.js";

const destination = "org.freedesktop.portal.Desktop";
const path = "/org/freedesktop/portal/desktop";
const remoteInterface = "org.freedesktop.portal.RemoteDesktop";
const requestInterface = "org.freedesktop.portal.Request";
type Options = Record<string, Variant<string | number | boolean>>;
type Results = Record<string, Variant<unknown>>;
interface Portal extends ClientInterface {
	CreateSession(options: Options): Promise<string>;
	SelectDevices(session: string, options: Options): Promise<string>;
	Start(session: string, parent: string, options: Options): Promise<string>;
	NotifyPointerMotion(session: string, options: Options, dx: number, dy: number): Promise<void>;
	NotifyPointerButton(session: string, options: Options, button: number, state: number): Promise<void>;
	NotifyPointerAxis(session: string, options: Options, dx: number, dy: number): Promise<void>;
	NotifyKeyboardKeycode(session: string, options: Options, keysym: number, state: number): Promise<void>;
}
interface BusControl extends ClientInterface {
	AddMatch(rule: string): Promise<void>;
	GetNameOwner(name: string): Promise<string>;
}

export interface WaylandInputTokens {
	read(): string | undefined;
	write(token: string): void;
	clear(): void;
}
interface PortalInputState {
	bus: MessageBus;
	abort: AbortController;
	session?: string;
	portal?: Portal;
	ready: Promise<void>;
	queue: Promise<void>;
	queued: number;
	scrollEnd?: ReturnType<typeof setTimeout>;
}
const log = getAppLogger("wayland-input");

/** Uses the compositor's consent flow. XTest cannot control native Wayland windows. */
export function createWaylandInputAdapter(
	tokens?: WaylandInputTokens,
	writeText?: (text: string) => void,
): SystemInputAdapter {
	let current: PortalInputState | undefined;
	const listeners = new Set<(granted: boolean) => void>();
	const notify = (granted: boolean) => {
		for (const listener of listeners) listener(granted);
	};
	const disable = () => {
		const previous = current;
		current = undefined;
		clearTimeout(previous?.scrollEnd);
		previous?.abort.abort();
		// Disconnecting the owning bus closes both pending requests and the portal session.
		previous?.bus.disconnect();
		if (previous) notify(false);
	};
	return {
		supported: true,
		get granted() {
			return Boolean(current?.portal);
		},
		pointerMode: "relative",
		onGrantedChange(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		setEnabled(enabled) {
			if (!enabled) {
				disable();
				return;
			}
			if (current) return current.ready;
			const state: PortalInputState = {
				bus: sessionBus(),
				abort: new AbortController(),
				ready: Promise.resolve(),
				queue: Promise.resolve(),
				queued: 0,
			};
			current = state;
			state.bus.on("error", () => {
				if (current === state) disable();
			});
			state.ready = abortable(
				state.abort.signal,
				(async () => {
					const control = (
						await state.bus.getProxyObject("org.freedesktop.DBus", "/org/freedesktop/DBus")
					).getInterface<BusControl>("org.freedesktop.DBus");
					const owner = await control.GetNameOwner(destination);
					await control.AddMatch(`type='signal',sender='${owner}',interface='${requestInterface}'`);
					const portal = (await state.bus.getProxyObject(destination, path)).getInterface<Portal>(remoteInterface);
					const properties = (await state.bus.getProxyObject(destination, path)).getInterface(
						"org.freedesktop.DBus.Properties",
					);
					const version: unknown = await properties.Get(remoteInterface, "version");
					const persistent = version instanceof Variant && typeof version.value === "number" && version.value >= 2;
					const request = (invoke: (options: Options) => Promise<string>, options: Options = {}) =>
						portalRequest(state.bus, owner, state.abort.signal, invoke, options);
					const created = await request((options) => portal.CreateSession(options), {
						session_handle_token: new Variant("s", token()),
					});
					const session = created.session_handle?.value;
					if (
						typeof session !== "string" ||
						!/^\/org\/freedesktop\/portal\/desktop\/session\/[A-Za-z0-9_/]+$/.test(session)
					)
						throw new Error("Invalid remote input session");
					state.session = session;
					let saved: string | undefined;
					try {
						saved = persistent ? tokens?.read() : undefined;
					} catch {
						log.warn("Could not read remembered Wayland input permission; requesting consent");
					}
					await request((options) => portal.SelectDevices(session, options), {
						types: new Variant("u", 3),
						...(persistent ? { persist_mode: new Variant("u", 2) } : {}),
						...(saved ? { restore_token: new Variant("s", saved) } : {}),
					});
					const started = await request((options) => portal.Start(session, "", options));
					if (current !== state || state.abort.signal.aborted) throw new Error("Remote input was revoked");
					const devices = started.devices?.value;
					if (typeof devices !== "number" || (devices & 3) !== 3)
						throw new Error("Pointer and keyboard permission was not granted");
					const restored = started.restore_token?.value;
					try {
						if (typeof restored === "string" && restored.length > 0 && restored.length <= 8192)
							tokens?.write(restored);
						else if (saved) tokens?.clear();
					} catch {
						// Persistence is optional; the compositor has already authorized this session.
						log.warn("Could not remember Wayland input permission; current session remains available");
					}
					const sessionInterface = (await state.bus.getProxyObject(destination, session)).getInterface(
						"org.freedesktop.portal.Session",
					);
					sessionInterface.on("Closed", () => {
						if (current === state) {
							// Closed ends this session; it does not revoke the stored restore permission.
							// Explicit user revocation clears it in the pairing service.
							disable();
						}
					});
					if (current !== state) throw new Error("Remote input was revoked");
					state.portal = portal;
					notify(true);
					log.info("Wayland input permission granted");
				})(),
			).catch((error: unknown) => {
				if (current === state) disable();
				throw error;
			});
			return state.ready;
		},
		apply(message) {
			const state = current;
			if (!state?.portal || !state.session) return;
			if (state.queued >= 256) {
				disable();
				log.warn("Wayland input queue exceeded its limit");
				return;
			}
			state.queued += 1;
			state.queue = state.queue
				.then(async () => {
					if (current !== state || !state.portal || !state.session) return;
					await inject(state.portal, state.session, message, () => current === state, writeText);
					if (message.type === "pointer.scroll") {
						clearTimeout(state.scrollEnd);
						state.scrollEnd = setTimeout(() => {
							state.queue = state.queue
								.then(async () => {
									if (current === state && state.portal && state.session)
										await state.portal.NotifyPointerAxis(
											state.session,
											{ finish: new Variant("b", true) },
											0,
											0,
										);
								})
								.catch(() => {
									if (current === state) disable();
								});
						}, 80);
					}
				})
				.catch(() => {
					if (current === state) {
						disable();
						log.warn("Wayland input session ended", { eventType: message.type });
					}
				})
				.finally(() => {
					state.queued -= 1;
				});
		},
	};
}

function token(): string {
	return `agent567_${randomUUID().replaceAll("-", "")}`;
}

/** Listen before invoking the method: a portal may emit Response before returning its path. */
async function portalRequest(
	bus: MessageBus,
	owner: string,
	signal: AbortSignal,
	invoke: (options: Options) => Promise<string>,
	options: Options,
): Promise<Results> {
	if (signal.aborted) throw new Error("Remote input was revoked");
	const handle = token();
	return new Promise<Results>((resolve, reject) => {
		let requestPath: string | undefined;
		let done = false;
		const finish = (error?: Error, results?: Results) => {
			if (done) return;
			done = true;
			clearTimeout(timeout);
			bus.removeListener("message", onMessage);
			signal.removeEventListener("abort", onAbort);
			if (error) reject(error);
			else resolve(results ?? {});
		};
		const closeRequest = () => {
			if (requestPath)
				void bus
					.call(new Message({ destination, path: requestPath, interface: requestInterface, member: "Close" }))
					.catch(() => undefined);
		};
		const onAbort = () => {
			closeRequest();
			finish(new Error("Remote input was revoked"));
		};
		const onMessage = (message: Message) => {
			if (
				message.sender !== owner ||
				message.interface !== requestInterface ||
				message.member !== "Response" ||
				!message.path?.endsWith(`/${handle}`)
			)
				return;
			const [code, value]: unknown[] = message.body;
			if (code !== 0) {
				finish(new Error("Remote input permission was cancelled"));
				return;
			}
			if (
				!value ||
				typeof value !== "object" ||
				Array.isArray(value) ||
				!Object.values(value).every((entry) => entry instanceof Variant)
			) {
				finish(new Error("Invalid portal response"));
				return;
			}
			finish(undefined, value as Results);
		};
		const timeout = setTimeout(() => {
			closeRequest();
			finish(new Error("Remote input permission timed out"));
		}, 120_000);
		bus.on("message", onMessage);
		signal.addEventListener("abort", onAbort, { once: true });
		void invoke({ ...options, handle_token: new Variant("s", handle) })
			.then((returned) => {
				requestPath = returned;
				if (signal.aborted) closeRequest();
			})
			.catch((error: unknown) => finish(error instanceof Error ? error : new Error("Remote input request failed")));
	});
}

async function inject(
	portal: Portal,
	session: string,
	message: RemoteInputMessage,
	active: () => boolean,
	writeText?: (text: string) => void,
): Promise<void> {
	if (message.type === "pointer.relative")
		await portal.NotifyPointerMotion(session, {}, message.deltaX, message.deltaY);
	else if (message.type === "pointer.button")
		await portal.NotifyPointerButton(
			session,
			{},
			message.button === "left" ? 272 : message.button === "right" ? 273 : 274,
			message.action === "down" ? 1 : 0,
		);
	else if (message.type === "pointer.scroll")
		await portal.NotifyPointerAxis(session, {}, message.deltaX, message.deltaY);
	else if (message.type === "key") {
		const code = waylandKeycode(message.code);
		if (code !== undefined) await portal.NotifyKeyboardKeycode(session, {}, code, message.action === "down" ? 1 : 0);
	} else if (message.type === "text") {
		if (!writeText) throw new Error("Remote text paste is unavailable");
		// Unicode keysyms are not consistently supported by compositors or input methods.
		// Only explicitly submitted text is written; the user's clipboard is never read.
		writeText(message.text);
		for (const [code, state] of [
			[29, 1],
			[47, 1],
			[47, 0],
			[29, 0],
		]) {
			if (!active()) return;
			await portal.NotifyKeyboardKeycode(session, {}, code, state);
		}
	}
}

function abortable<T>(signal: AbortSignal, operation: Promise<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", cancel);
		};
		const cancel = () => {
			cleanup();
			reject(new Error("Remote input was revoked"));
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("Remote input permission timed out"));
		}, 120_000);
		signal.addEventListener("abort", cancel, { once: true });
		if (signal.aborted) cancel();
		operation.then(
			(value) => {
				cleanup();
				resolve(value);
			},
			(error: unknown) => {
				cleanup();
				reject(error);
			},
		);
	});
}
