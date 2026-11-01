import type { HistoryEntry, RuntimeHost } from "@567agent/runtime-core";
import type { DesktopVisibleConversation } from "../../shared/visible-conversation.js";

/** Renderer supplies only a runtime identity; catalog owns public identity and title. */
export class VisibleConversationSelection {
	private selected: { runtimeId: string; id: string; title: string } | null = null;
	private generation = 0;
	private desiredRuntimeId: string | null = null;
	private unsubscribe: (() => void) | undefined;
	private terminal: "failed" | "interrupted" | null = null;
	refresh(): Promise<void> {
		return this.select(this.desiredRuntimeId);
	}
	constructor(
		private readonly runtime: () => Pick<RuntimeHost, "getSessionPath" | "getState" | "getFullHistory" | "subscribe">,
		private readonly locate: (path: string) => Promise<{ id: string; title: string } | null>,
		private readonly waiting: (runtimeId: string) => boolean,
	) {}
	async select(runtimeId: string | null): Promise<void> {
		this.desiredRuntimeId = runtimeId;
		const generation = ++this.generation;
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		if (runtimeId === null || runtimeId !== this.selected?.runtimeId) this.selected = null;
		if (runtimeId === null) return;
		const path = this.runtime().getSessionPath(runtimeId);
		if (!path) return;
		const identity = await this.locate(path);
		if (generation !== this.generation) return;
		if (!identity) {
			this.selected = null;
			return;
		}
		this.selected = { runtimeId, ...identity };
		this.terminal = null;
		const history = this.runtime().getFullHistory(runtimeId);
		if (!this.selected.title) this.selected.title = firstPromptTitle(history);
		for (let index = history.length - 1; index >= 0; index--) {
			const entry = history[index];
			if (entry.type === "error") {
				this.terminal = "failed";
				break;
			}
			if (entry.type !== "message") continue;
			if (entry.message.role === "user") break;
			if (entry.message.role === "assistant") {
				this.terminal =
					entry.message.stopReason === "error"
						? "failed"
						: entry.message.stopReason === "aborted"
							? "interrupted"
							: null;
				break;
			}
		}
		this.unsubscribe = this.runtime().subscribe(runtimeId, (event) => {
			if (generation !== this.generation) return;
			if (event.type === "session.lifecycle" && event.phase === "agent_start") {
				this.terminal = null;
				// A new conversation can be selected before its first prompt is persisted.
				if (this.selected && !this.selected.title)
					this.selected.title = firstPromptTitle(this.runtime().getFullHistory(runtimeId));
			}
			if (event.type === "session.lifecycle" && event.phase === "aborted") this.terminal = "interrupted";
			if (event.type === "error" && event.channel !== "assistant") this.terminal = "failed";
		});
	}
	snapshot(): DesktopVisibleConversation | null {
		const selected = this.selected;
		if (!selected) return null;
		try {
			const state = this.runtime().getState(selected.runtimeId);
			const status = this.waiting(selected.runtimeId)
				? "waiting"
				: state.isStreaming
					? "running"
					: (this.terminal ?? "idle");
			return { id: selected.id, title: selected.title, status };
		} catch {
			return null;
		}
	}
}

function firstPromptTitle(history: readonly HistoryEntry[]): string {
	for (const entry of history) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const content = entry.message.content;
		return (
			typeof content === "string"
				? content
				: content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join(" ")
		)
			.trim()
			.slice(0, 300);
	}
	return "";
}
