import type { ConversationEvent, PluginContext, PluginFsStatResult } from "@vetta-org/plugin-sdk";
import { expect, it, vi } from "vitest";
import { restoreSessionCanvas } from "../src/restore-session-canvas";

it("restores a saved board once per visit and ignores pending probes after a switch or disposal", async () => {
	const pending: Array<(value: PluginFsStatResult | null) => void> = [];
	const stat = vi.fn(() => new Promise<PluginFsStatResult | null>((resolve) => pending.push(resolve)));
	const openActivityTab = vi.fn();
	const dispose = vi.fn();
	let receive: (event: ConversationEvent) => void = () => {};
	const ctx = {
		fs: { stat },
		ui: { openActivityTab },
		conversation: { on: (listener: typeof receive) => ((receive = listener), { dispose }) },
	} as unknown as Pick<PluginContext, "fs" | "ui" | "conversation">;
	const change = (id: string | null) =>
		receive({
			type: "conversation-changed",
			conversation: { id, cwd: "/project", sessionPath: id ? `/sessions/${id}.jsonl` : null, model: null, isStreaming: false },
		});
	const resolveProbe = async () => {
		pending.shift()?.({ size: 100, createdAt: 0, modifiedAt: 0 });
		pending.shift()?.(null);
		await Promise.resolve();
		await Promise.resolve();
	};

	const subscription = restoreSessionCanvas(ctx, "canvas");
	change("a");
	change("a");
	expect(stat).toHaveBeenCalledTimes(2);
	change(null);
	await resolveProbe();
	expect(openActivityTab).not.toHaveBeenCalled();
	change("a");
	await resolveProbe();
	expect(openActivityTab).toHaveBeenCalledExactlyOnceWith("canvas", { cwd: "/project", width: "max" });
	change("a");
	expect(stat).toHaveBeenCalledTimes(4);
	change("b");
	subscription.dispose();
	await resolveProbe();
	expect(openActivityTab).toHaveBeenCalledOnce();
	expect(dispose).toHaveBeenCalledOnce();
});
