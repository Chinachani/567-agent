import type { AssistantMessageEvent } from "../protocol/stream-event.js";

/** Observe at push time, so slow consumers and queued events do not distort timing. */
export class ModelCallTiming {
	private readonly startedAt = performance.now();
	private firstOutputMs?: number;
	private firstTextMs?: number;
	private ended = false;

	observe(event: AssistantMessageEvent): void {
		if (this.ended) return;
		const elapsed = Math.max(0, performance.now() - this.startedAt);
		if (
			(event.type === "text_delta" || event.type === "thinking_delta" || event.type === "toolcall_delta") &&
			event.delta.length > 0
		) {
			this.firstOutputMs ??= elapsed;
			if (event.type === "text_delta") this.firstTextMs ??= elapsed;
		} else if (event.type === "toolcall_start") {
			const block = event.partial.content[event.contentIndex];
			if (block?.type === "toolCall" && block.name) this.firstOutputMs ??= elapsed;
		}
		if (event.type === "error") this.ended = true;
		if (event.type !== "done") return;
		this.ended = true;
		// The innermost provider stream owns these observations. Forwarding layers
		// preserve them, including the shared usage referenced by adapter metadata.
		// Extension adapters may freeze their snapshots; optional observations must
		// never turn an otherwise successful response into a model failure.
		if (!Object.isExtensible(event.message.usage)) return;
		event.message.usage.performance ??= {
			durationMs: elapsed,
			...(this.firstOutputMs === undefined ? {} : { firstOutputMs: this.firstOutputMs }),
			...(this.firstTextMs === undefined ? {} : { firstTextMs: this.firstTextMs }),
		};
	}
}
