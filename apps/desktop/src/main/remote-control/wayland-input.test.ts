import { EventEmitter } from "node:events";
import { Variant } from "dbus-next";
import { afterEach, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ bus: vi.fn() }));
vi.mock("dbus-next", async (actual) => ({ ...(await actual<object>()), sessionBus: boundary.bus }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info: vi.fn(), warn: vi.fn() }) }));

import { createWaylandInputAdapter } from "./wayland-input.js";

const adapters: ReturnType<typeof createWaylandInputAdapter>[] = [];
afterEach(() => {
	for (const adapter of adapters) adapter.setEnabled(false);
	adapters.length = 0;
	vi.resetAllMocks();
});

function fixture(cancel = false, streams?: unknown) {
	const bus = Object.assign(new EventEmitter(), {
		disconnect: vi.fn(),
		call: vi.fn(async () => null),
		getProxyObject: vi.fn(),
	});
	let held: (() => void) | undefined;
	const session = "/org/freedesktop/portal/desktop/session/test/test";
	const sessionEvents = new EventEmitter();
	const respond = (
		options: Record<string, Variant<unknown>>,
		results: Record<string, Variant<unknown>>,
		code = cancel ? 1 : 0,
	) => {
		const path = `/org/freedesktop/portal/desktop/request/test/${options.handle_token.value}`;
		// Deliberately emits before the method reply, as real portals may do.
		bus.emit("message", {
			sender: ":1.23",
			interface: "org.freedesktop.portal.Request",
			member: "Response",
			path,
			body: [code, results],
		});
		return Promise.resolve(path);
	};
	const portal = {
		CreateSession: vi.fn((options) => respond(options, { session_handle: new Variant("o", session) })),
		SelectDevices: vi.fn((_session, options) => respond(options, {})),
		SelectSources: vi.fn((_session, options) => respond(options, {})),
		Start: vi.fn((_session, _parent, options) =>
			respond(options, {
				devices: new Variant("u", 3),
				restore_token: new Variant("s", "rotated-token"),
				...(streams ? { streams: new Variant("a(ua{sv})", streams) } : {}),
			}),
		),
		NotifyPointerMotion: vi.fn(async () => {}),
		NotifyPointerMotionAbsolute: vi.fn(async () => {}),
		NotifyPointerButton: vi.fn(async () => {}),
		NotifyPointerAxis: vi.fn(async () => {}),
		NotifyKeyboardKeycode: vi.fn(async () => {}),
	};
	bus.getProxyObject.mockResolvedValue({
		getInterface: (name: string) => {
			if (name === "org.freedesktop.DBus") return { AddMatch: async () => {}, GetNameOwner: async () => ":1.23" };
			if (name === "org.freedesktop.DBus.Properties") return { Get: async () => new Variant("u", 2) };
			if (name === "org.freedesktop.portal.Session") return sessionEvents;
			return portal;
		},
	});
	boundary.bus.mockReturnValue(bus);
	const tokens = { read: vi.fn(() => "saved-token"), write: vi.fn(), clear: vi.fn() };
	const writeText = vi.fn();
	const adapter = createWaylandInputAdapter(tokens, writeText);
	adapters.push(adapter);
	return {
		adapter,
		respond,
		writeText,
		sessionEvents,
		portal,
		bus,
		tokens,
		holdStart() {
			portal.Start.mockImplementationOnce(
				(_s, _p, options) =>
					new Promise((resolve) => {
						held = () => {
							void respond(options, { devices: new Variant("u", 3) }).then(resolve);
						};
					}),
			);
		},
		release() {
			held?.();
		},
	};
}

it("requests system permission, restores and rotates its token, controls pointer/keyboard, then stops immediately on revoke", async () => {
	const { adapter, portal, bus, tokens } = fixture();
	adapter.apply({ type: "pointer.relative", sequence: 1, deltaX: 12, deltaY: -4 });
	expect(portal.NotifyPointerMotion).not.toHaveBeenCalled();
	await adapter.setEnabled(true);
	expect(portal.SelectDevices.mock.calls[0][1].restore_token.value).toBe("saved-token");
	expect(portal.SelectDevices.mock.calls[0][1].persist_mode.value).toBe(2);
	expect(tokens.write).toHaveBeenCalledWith("rotated-token");
	adapter.apply({ type: "pointer.relative", sequence: 2, deltaX: 12, deltaY: -4 });
	adapter.apply({ type: "pointer.button", sequence: 3, x: 0, y: 0, button: "left", action: "down" });
	adapter.apply({ type: "pointer.button", sequence: 4, x: 0, y: 0, button: "left", action: "up" });
	adapter.apply({ type: "text", sequence: 5, text: "中" });
	await vi.waitFor(() => expect(portal.NotifyKeyboardKeycode).toHaveBeenCalledTimes(4));
	expect(portal.NotifyPointerMotion).toHaveBeenCalledWith(expect.any(String), {}, 12, -4);
	expect(portal.NotifyPointerButton.mock.calls.map((call) => call.slice(2))).toEqual([
		[272, 1],
		[272, 0],
	]);
	adapter.setEnabled(false);
	adapter.apply({ type: "pointer.relative", sequence: 6, deltaX: 99, deltaY: 99 });
	expect(bus.disconnect).toHaveBeenCalledOnce();
	expect(portal.NotifyPointerMotion).toHaveBeenCalledTimes(1);
});

it("cancellation grants no input and leaves no response listener", async () => {
	const { adapter, portal, bus } = fixture(true);
	await expect(adapter.setEnabled(true)).rejects.toThrow("cancelled");
	adapter.apply({ type: "key", sequence: 1, code: "Enter", action: "down" });
	expect(portal.NotifyKeyboardKeycode).not.toHaveBeenCalled();
	expect(bus.listenerCount("message")).toBe(0);
	expect(bus.disconnect).toHaveBeenCalledOnce();
});

it("a grant arriving after revoke cannot restore control or persist a token", async () => {
	const f = fixture();
	f.holdStart();
	const granting = Promise.resolve(f.adapter.setEnabled(true));
	await vi.waitFor(() => expect(f.portal.Start).toHaveBeenCalledOnce());
	f.adapter.setEnabled(false);
	await expect(granting).rejects.toThrow("revoked");
	f.release();
	expect(f.tokens.write).not.toHaveBeenCalled();
	expect(f.bus.listenerCount("message")).toBe(0);
});

it("revocation also interrupts initialization before the portal has returned any interface", async () => {
	const f = fixture();
	f.bus.getProxyObject.mockReturnValueOnce(new Promise(() => {}));
	const ready = Promise.resolve(f.adapter.setEnabled(true));
	f.adapter.setEnabled(false);
	await expect(ready).rejects.toThrow("revoked");
	expect(f.bus.disconnect).toHaveBeenCalledOnce();
	expect(f.adapter.granted).toBe(false);
});

it("keeps this authorized session usable when remembering permission fails", async () => {
	const f = fixture();
	const changes = vi.fn();
	f.adapter.onGrantedChange?.(changes);
	f.tokens.write.mockImplementation(() => {
		throw new Error("Storage unavailable");
	});
	await f.adapter.setEnabled(true);
	expect(f.adapter.granted).toBe(true);
	f.adapter.apply({ type: "pointer.relative", sequence: 1, deltaX: 2, deltaY: 3 });
	await vi.waitFor(() => expect(f.portal.NotifyPointerMotion).toHaveBeenCalledOnce());
	expect(changes).toHaveBeenLastCalledWith(true);
	f.sessionEvents.emit("Closed", {});
	expect(changes).toHaveBeenLastCalledWith(false);
	expect(f.adapter.granted).toBe(false);
	expect(f.tokens.clear).not.toHaveBeenCalled();
});

it("broadcasts input loss on overflow, discards queued events, and can request permission again", async () => {
	const f = fixture();
	const changes = vi.fn();
	f.adapter.onGrantedChange?.(changes);
	await f.adapter.setEnabled(true);
	for (let sequence = 1; sequence <= 257; sequence++)
		f.adapter.apply({ type: "pointer.relative", sequence, deltaX: 1, deltaY: 1 });
	expect(f.adapter.granted).toBe(false);
	expect(changes).toHaveBeenLastCalledWith(false);
	await vi.waitFor(() => expect(f.bus.disconnect).toHaveBeenCalledOnce());
	await f.adapter.setEnabled(true);
	expect(f.adapter.granted).toBe(true);
	expect(changes).toHaveBeenLastCalledWith(true);
	expect(f.tokens.clear).not.toHaveBeenCalled();
});

it("delivers physical shortcuts and Unicode paste and completes a scroll series", async () => {
	const { adapter, portal, writeText } = fixture();
	await adapter.setEnabled(true);
	adapter.apply({ type: "key", sequence: 1, code: "Escape", action: "down" });
	adapter.apply({ type: "key", sequence: 2, code: "Escape", action: "up" });
	adapter.apply({ type: "key", sequence: 3, code: "Enter", action: "down" });
	adapter.apply({ type: "key", sequence: 4, code: "Enter", action: "up" });
	adapter.apply({ type: "text", sequence: 5, text: "中文 hello 🌟" });
	adapter.apply({ type: "pointer.scroll", sequence: 6, deltaX: 0, deltaY: 24 });
	await vi.waitFor(() => expect(portal.NotifyPointerAxis).toHaveBeenCalledTimes(2));
	expect(writeText).toHaveBeenCalledWith("中文 hello 🌟");
	expect(portal.NotifyKeyboardKeycode.mock.calls.map((call) => call.slice(2))).toEqual([
		[1, 1],
		[1, 0],
		[28, 1],
		[28, 0],
		[29, 1],
		[47, 1],
		[47, 0],
		[29, 0],
	]);
	expect(portal.NotifyPointerAxis).toHaveBeenLastCalledWith(
		expect.any(String),
		{ finish: new Variant("b", true) },
		0,
		0,
	);
});

const monitor = (width = 1920) => [
	77,
	{
		position: new Variant("(ii)", [0, 0]),
		size: new Variant("(ii)", [width, 1080]),
		source_type: new Variant("u", 1),
	},
];
it("enables tablet coordinates only after portal consent returns the exact captured monitor, then revokes on a source change", async () => {
	const f = fixture(false, [monitor()]);
	f.adapter.setCaptureTarget?.({ x: 0, y: 0, width: 1920, height: 1080 });
	expect(f.adapter.pointerMode).toBe("relative");
	await f.adapter.setEnabled(true);
	expect(f.portal.SelectSources).toHaveBeenCalledWith(
		expect.any(String),
		expect.objectContaining({ types: new Variant("u", 1), multiple: new Variant("b", false) }),
	);
	expect(f.adapter.pointerMode).toBe("absolute");
	f.adapter.apply({ type: "pointer.move", sequence: 1, x: 0.25, y: 0.5 });
	f.adapter.apply({ type: "pointer.button", sequence: 2, x: 0.25, y: 0.5, button: "left", action: "down" });
	f.adapter.apply({ type: "pointer.button", sequence: 3, x: 0.25, y: 0.5, button: "left", action: "up" });
	await vi.waitFor(() => expect(f.portal.NotifyPointerButton).toHaveBeenCalledTimes(2));
	expect(f.portal.NotifyPointerMotionAbsolute).toHaveBeenCalledWith(expect.any(String), {}, 77, 479.75, 539.5);
	f.adapter.setCaptureTarget?.(undefined);
	expect(f.adapter.granted).toBe(false);
	expect(f.adapter.pointerMode).toBe("relative");
	const count = f.portal.NotifyPointerMotionAbsolute.mock.calls.length;
	f.adapter.apply({ type: "pointer.move", sequence: 4, x: 1, y: 1 });
	expect(f.portal.NotifyPointerMotionAbsolute).toHaveBeenCalledTimes(count);
});
it.each([
	{ streams: [monitor(1280)] },
	{ streams: [monitor(), monitor()] },
	{ streams: [[77, { size: new Variant("(ii)", [1920, 1080]) }]] },
])("keeps trackpad mode for ambiguous or mismatched screen mappings", async ({ streams }) => {
	const f = fixture(false, streams);
	f.adapter.setCaptureTarget?.({ x: 0, y: 0, width: 1920, height: 1080 });
	await f.adapter.setEnabled(true);
	expect(f.adapter.pointerMode).toBe("relative");
	f.adapter.apply({ type: "pointer.move", sequence: 1, x: 1, y: 1 });
	f.adapter.apply({ type: "pointer.relative", sequence: 2, deltaX: 4, deltaY: 5 });
	await vi.waitFor(() => expect(f.portal.NotifyPointerMotion).toHaveBeenCalledOnce());
	expect(f.portal.NotifyPointerMotionAbsolute).not.toHaveBeenCalled();
});

it.each(["unsupported", "cancelled"])(
	"keeps relative input available when screen source selection is %s",
	async (failure) => {
		const f = fixture(false, [monitor()]);
		f.adapter.setCaptureTarget?.({ x: 0, y: 0, width: 1920, height: 1080 });
		if (failure === "unsupported")
			f.portal.SelectSources.mockRejectedValueOnce(new Error("unsupported combined session"));
		else f.portal.SelectSources.mockImplementationOnce((_session, options) => f.respond(options, {}, 1));
		await f.adapter.setEnabled(true);
		expect(f.adapter.granted).toBe(true);
		expect(f.adapter.pointerMode).toBe("relative");
		expect(f.portal.CreateSession).toHaveBeenCalledTimes(2);
		f.adapter.apply({ type: "pointer.relative", sequence: 1, deltaX: 5, deltaY: 6 });
		await vi.waitFor(() => expect(f.portal.NotifyPointerMotion).toHaveBeenCalledOnce());
		expect(f.portal.NotifyPointerMotionAbsolute).not.toHaveBeenCalled();
	},
);

it.each([1, 2])("respects cancellation but falls back for a combined-session failure at Start (%s)", async (code) => {
	const f = fixture(false, [monitor()]);
	f.adapter.setCaptureTarget?.({ x: 0, y: 0, width: 1920, height: 1080 });
	f.portal.Start.mockImplementationOnce((_session, _parent, options) => f.respond(options, {}, code));
	if (code === 1) {
		await expect(f.adapter.setEnabled(true)).rejects.toThrow("cancelled");
		expect(f.adapter.granted).toBe(false);
		expect(f.portal.Start).toHaveBeenCalledTimes(1);
	} else {
		await f.adapter.setEnabled(true);
		expect(f.adapter.granted).toBe(true);
		expect(f.adapter.pointerMode).toBe("relative");
		expect(f.portal.Start).toHaveBeenCalledTimes(2);
	}
});
