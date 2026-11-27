import { expect, it } from "vitest";
import { decodeEvent } from "./host-protocol.js";
import { StatusStore } from "./status-store.js";

it("replaces channel status snapshots across failure, restart, and legacy events", () => {
	const store = new StatusStore();
	const apply = (frame: object) => {
		const event = decodeEvent(JSON.stringify({ type: "status", transport: "online", time: "2026-11-26", ...frame }));
		if (event?.type !== "status") throw new Error("Expected sidecar status event");
		store.applyStatusEvent(event);
	};
	apply({ channelStatuses: { wechat: "online", telegram: "online" } });
	const first = store.get();
	apply({ channelStatuses: { wechat: "online", telegram: "error" } });
	expect(store.get().channelStatuses).toEqual({ wechat: "online", telegram: "error" });
	expect(first.channelStatuses).toEqual({ wechat: "online", telegram: "online" });
	apply({ transport: "connecting", channelStatuses: {} });
	expect(store.get().channelStatuses).toEqual({});
	apply({ transport: "online" });
	expect(store.get().channelStatuses).toBeUndefined();
});
