import type { RuntimeHost } from "@567agent/runtime-core";
import { expect, it } from "vitest";
import { VisibleConversationSelection } from "./visible-conversation-selection.js";

it("uses catalog identity, tracks execution and clears stale selection across async navigation", async () => {
	let running = true;
	let waiting = false;
	let delayed: ((value: { id: string; title: string } | null) => void) | undefined;
	const selection = new VisibleConversationSelection(
		() => ({
			getSessionPath: (id: string) => `/sessions/${id}`,
			getState: () => ({ isStreaming: running }) as ReturnType<RuntimeHost["getState"]>,
			getFullHistory: () => [],
			subscribe: () => () => {},
		}),
		async (path) =>
			path.endsWith("slow")
				? new Promise((resolve) => {
						delayed = resolve;
					})
				: path.endsWith("hidden")
					? null
					: { id: "catalog-id", title: "Saved title" },
		() => waiting,
	);
	await selection.select("current");
	expect(selection.snapshot()).toEqual({ id: "catalog-id", title: "Saved title", status: "running" });
	waiting = true;
	expect(selection.snapshot()?.status).toBe("waiting");
	waiting = false;
	running = false;
	expect(selection.snapshot()?.status).toBe("idle");
	const old = selection.select("slow");
	await selection.select(null);
	delayed?.({ id: "old", title: "Old" });
	await old;
	expect(selection.snapshot()).toBeNull();
	await selection.select("hidden");
	expect(selection.snapshot()).toBeNull();
});

it("projects the first persisted prompt as the title when an empty conversation begins its first turn", async () => {
	let history: ReturnType<RuntimeHost["getFullHistory"]> = [];
	let onEvent: Parameters<RuntimeHost["subscribe"]>[1] | undefined;
	const selection = new VisibleConversationSelection(
		() => ({
			getSessionPath: () => "/session",
			getState: () => ({ isStreaming: true }) as ReturnType<RuntimeHost["getState"]>,
			getFullHistory: () => history,
			subscribe: (_id, listener) => {
				onEvent = listener;
				return () => {};
			},
		}),
		async () => ({ id: "catalog", title: "" }),
		() => false,
	);
	await selection.select("runtime");
	history = [
		{
			type: "message",
			entryId: "user-1",
			message: { role: "user", content: "Canonical first request", timestamp: 1 },
		},
	];
	onEvent?.({
		type: "session.lifecycle",
		schemaVersion: 1,
		source: "runtime-core",
		sessionId: "runtime",
		eventId: "start",
		timestamp: 1,
		phase: "agent_start",
	});
	expect(selection.snapshot()).toEqual({ id: "catalog", title: "Canonical first request", status: "running" });
});
