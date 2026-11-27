import type { Disposable, PluginContext } from "@vetta-org/plugin-sdk";
import { getSessionCanvasDir } from "./canvas-session-path";
import { hasStoredCanvas } from "./vettaCowartBridge";

export function restoreSessionCanvas(ctx: Pick<PluginContext, "conversation" | "fs" | "ui">, tabId: string): Disposable {
	type CanvasProbe = { id: string | null; cwd: string; sessionPath: string; status: "checking" | "empty" | "opened" };
	let active: CanvasProbe | undefined;
	const subscription = ctx.conversation.on((event) => {
		if (event.type !== "conversation-changed") return;
		const { id, cwd, sessionPath } = event.conversation;
		if (!cwd || !sessionPath) {
			active = undefined;
			return;
		}
		if (active && active.status !== "empty" && active.id === id && active.cwd === cwd && active.sessionPath === sessionPath) return;
		const candidate: CanvasProbe = { id, cwd, sessionPath, status: "checking" };
		active = candidate;
		void (async () => {
			const board = await hasStoredCanvas(ctx.fs, getSessionCanvasDir(cwd, sessionPath));
			candidate.status = board ? "opened" : "empty";
			if (!board || active !== candidate) return;
			ctx.ui.openActivityTab(tabId, { cwd, width: "max" });
		})().catch(() => {
			candidate.status = "empty";
		});
	});
	return {
		dispose() {
			active = undefined;
			subscription.dispose();
		},
	};
}
