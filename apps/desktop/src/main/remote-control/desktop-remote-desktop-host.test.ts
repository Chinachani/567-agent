import type { DesktopCapturerSource, DisplayMediaRequestHandlerHandlerRequest, Streams } from "electron";
import { afterEach, expect, it, vi } from "vitest";

const os = vi.hoisted(() => ({
	handler: null as
		| null
		| ((request: DisplayMediaRequestHandlerHandlerRequest, callback: (streams: Streams) => void) => void),
	consent: vi.fn(),
	sources: vi.fn(),
	enabled: vi.fn(),
	warn: vi.fn(),
	parent: undefined as { isDestroyed(): boolean; isVisible(): boolean } | undefined,
	remember: vi.fn(),
}));
vi.mock("electron", async () => {
	const { EventEmitter } = await import("node:events");
	class Window extends EventEmitter {
		destroyed = false;
		webContents = Object.assign(new EventEmitter(), { id: 10, executeJavaScript: vi.fn(async () => {}) });
		isDestroyed() {
			return this.destroyed;
		}
		destroy() {
			this.destroyed = true;
		}
		loadURL = vi.fn(async () => {});
	}
	return {
		BrowserWindow: Window,
		ipcMain: new EventEmitter(),
		dialog: { showMessageBox: os.consent },
		screen: { getPrimaryDisplay: () => ({ id: 1 }) },
		webContents: { fromFrame: () => ({ id: 10 }) },
		session: {
			fromPartition: () => ({
				setDisplayMediaRequestHandler: (handler: typeof os.handler) => {
					os.handler = handler;
				},
				setPermissionCheckHandler: vi.fn(),
				setPermissionRequestHandler: vi.fn(),
			}),
		},
		desktopCapturer: { getSources: os.sources },
	};
});
vi.mock("../window-manager.js", () => ({ getMainWindow: () => os.parent }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info: vi.fn(), warn: os.warn }) }));
vi.mock("./system-input.js", () => ({
	createSystemInputAdapter: () => ({ supported: true, setEnabled: os.enabled, apply: vi.fn() }),
}));

import { type DesktopRemoteDesktopHostHandle, startDesktopRemoteDesktopHost } from "./desktop-remote-desktop-host.js";

let host: DesktopRemoteDesktopHostHandle | undefined;
afterEach(async () => {
	await host?.stop();
	host = undefined;
	os.handler = null;
	vi.resetAllMocks();
	vi.unstubAllEnvs();
});
const request = { frame: {}, videoRequested: true, audioRequested: false } as DisplayMediaRequestHandlerHandlerRequest;
async function start() {
	host = await startDesktopRemoteDesktopHost({
		appRoot: "/isolated",
		isPackaged: false,
		inputEnabled: false,
		signalingTargets: ["wss://example.invalid/host"],
		onAutoShareScreenChange: os.remember,
	});
}
function capture() {
	return new Promise<Streams | null>((resolve) =>
		os.handler!(request, (streams) => {
			// Electron 34 distinguishes an omitted video property from video: undefined.
			if (streams && Object.hasOwn(streams, "video") && streams.video === undefined)
				throw new TypeError("video must be a WebFrameMain or DesktopCapturerSource");
			resolve(streams);
		}),
	);
}
it("denies capture with an empty result and still accepts a later explicit request", async () => {
	os.consent
		.mockResolvedValueOnce({ response: 1 })
		.mockResolvedValueOnce({ response: 0 })
		.mockResolvedValueOnce({ response: 1 });
	const source = { id: "screen:1", display_id: "1", name: "Screen" } as DesktopCapturerSource;
	os.sources.mockResolvedValue([source]);
	await start();
	expect(await capture()).toBeNull();
	expect(os.sources).not.toHaveBeenCalled();
	expect(host!.inputSupported).toBe(false);
	expect((await capture())?.video).toBe(source);
});
it("handles portal rejection and expired native callbacks without an unhandled rejection or double callback", async () => {
	os.consent.mockResolvedValue({ response: 0 });
	os.sources.mockRejectedValue(new Error("Failed to get sources."));
	await start();
	expect(await capture()).toBeNull();
	const callback = vi.fn(() => {
		throw new Error("Request already gone");
	});
	os.handler!(request, callback);
	await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
	expect(callback.mock.calls[0]).toEqual([null]);
	expect(host!.inputSupported).toBe(false);
});

it("a late approval after the host stops cannot start capture or restore input permission", async () => {
	let approve!: (value: { response: number; checkboxChecked?: boolean }) => void;
	os.consent.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				approve = resolve;
			}),
	);
	await start();
	const result = capture();
	await host!.stop();
	host = undefined;
	approve({ response: 0, checkboxChecked: true });
	expect(await result).toBeNull();
	expect(os.sources).not.toHaveBeenCalled();
	expect(os.remember).not.toHaveBeenCalled();
});

it("does not advertise input capability when a late native grant callback has expired", async () => {
	const source = { id: "screen:1", display_id: "1", name: "Screen" } as DesktopCapturerSource;
	os.sources.mockResolvedValue([source]);
	await start();
	host!.setAutoShareScreen(true);
	const callback = vi.fn(() => {
		throw new Error("Request already expired");
	});
	os.handler!(request, callback);
	await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
	expect(callback.mock.calls[0]).toEqual([{ video: source }]);
	expect(host!.inputSupported).toBe(false);
});

it("serializes system pickers and settles pending requests before closing the hidden window", async () => {
	os.consent.mockResolvedValue({ response: 0 });
	let select!: (sources: DesktopCapturerSource[]) => void;
	os.sources.mockImplementationOnce(
		() =>
			new Promise<DesktopCapturerSource[]>((resolve) => {
				select = resolve;
			}),
	);
	await start();
	const first = capture();
	await vi.waitFor(() => expect(os.sources).toHaveBeenCalledOnce());
	expect(await capture()).toBeNull();
	await host!.stop();
	host = undefined;
	expect(await first).toBeNull();
	select([{ id: "screen:1", display_id: "1", name: "Screen" } as DesktopCapturerSource]);
	await Promise.resolve();
	expect(os.enabled).not.toHaveBeenCalledWith(true);
});

it("shows approval independently when the main window is hidden in the tray", async () => {
	os.parent = { isDestroyed: () => false, isVisible: () => false };
	os.consent.mockResolvedValue({ response: 1 });
	await start();
	expect(await capture()).toBeNull();
	expect(os.consent.mock.calls[0]).toHaveLength(1);
	os.parent = undefined;
});

it.runIf(process.platform === "linux")(
	"uses the sole system-selected Wayland source directly on initial capture and after sharing is stopped",
	async () => {
		vi.stubEnv("XDG_SESSION_TYPE", "wayland");
		const first = { id: "window:0:0", display_id: "", name: "" } as DesktopCapturerSource;
		const next = { id: "window:1:0", display_id: "", name: "" } as DesktopCapturerSource;
		os.sources.mockResolvedValueOnce([first]).mockResolvedValueOnce([next]);
		// A redundant app picker would cancel; the system already selected this source.
		os.consent.mockResolvedValue({ response: 0 });
		await start();
		host!.setAutoShareScreen(true);
		expect((await capture())?.video).toBe(first);
		expect((await capture())?.video).toBe(next);
		expect(os.sources).toHaveBeenCalledTimes(2);
		expect(os.consent).not.toHaveBeenCalled();
	},
);

it.runIf(process.platform === "linux")(
	"still asks for app approval before using the system-selected Wayland source for an unremembered phone",
	async () => {
		vi.stubEnv("XDG_SESSION_TYPE", "wayland");
		const source = { id: "window:0:0", display_id: "", name: "" } as DesktopCapturerSource;
		os.sources.mockResolvedValue([source]);
		os.consent.mockResolvedValueOnce({ response: 1 }).mockResolvedValueOnce({ response: 0 });
		await start();
		expect(await capture()).toBeNull();
		expect(os.sources).not.toHaveBeenCalled();
		expect((await capture())?.video).toBe(source);
		expect(os.consent).toHaveBeenCalledTimes(2);
	},
);

it.runIf(process.platform === "linux")(
	"keeps explicit source selection on X11 even when only one source is returned",
	async () => {
		vi.stubEnv("XDG_SESSION_TYPE", "x11");
		vi.stubEnv("WAYLAND_DISPLAY", "");
		const source = { id: "window:1:0", display_id: "", name: "Window" } as DesktopCapturerSource;
		os.sources.mockResolvedValue([source]);
		os.consent.mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 });
		await start();
		expect((await capture())?.video).toBe(source);
		expect(os.consent).toHaveBeenCalledTimes(2);
	},
);

it.runIf(process.platform === "linux")(
	"does not silently choose a Wayland source if several candidates are returned",
	async () => {
		vi.stubEnv("XDG_SESSION_TYPE", "wayland");
		os.sources.mockResolvedValue([
			{ id: "window:1:0", display_id: "", name: "First" },
			{ id: "window:2:0", display_id: "", name: "Second" },
		]);
		os.consent.mockResolvedValue({ response: 0 });
		await start();
		host!.setAutoShareScreen(true);
		expect(await capture()).toBeNull();
		expect(os.consent).toHaveBeenCalledOnce();
	},
);
