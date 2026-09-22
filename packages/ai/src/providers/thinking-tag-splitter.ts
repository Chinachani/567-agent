interface TagPair {
	readonly open: string;
	readonly close: string;
}

const TAG_PAIRS: readonly TagPair[] = [
	{ open: "<thinking>", close: "</thinking>" },
	{ open: "<think>", close: "</think>" },
	{ open: "<thought>", close: "</thought>" },
];

const ALL_OPEN_TAGS = TAG_PAIRS.map((p) => p.open);
const ALL_CLOSE_TAGS = TAG_PAIRS.map((p) => p.close);

export type ThinkingTagSegment = { kind: "text" | "thinking"; text: string };

/** Longest suffix of `buffer` that is a proper prefix of any tag in `tags` (a tag split across two deltas). */
function partialTagSuffixLength(buffer: string, tags: readonly string[]): number {
	const lower = buffer.toLowerCase();
	let maxHold = 0;
	for (const tag of tags) {
		const lowerTag = tag.toLowerCase();
		const max = Math.min(lower.length, lowerTag.length - 1);
		for (let k = max; k > maxHold; k--) {
			if (lower.endsWith(lowerTag.slice(0, k))) {
				maxHold = k;
				break;
			}
		}
	}
	return maxHold;
}

interface TagMatch {
	readonly index: number;
	readonly length: number;
	readonly pair: TagPair;
}

function findEarliestOpenTag(buffer: string): TagMatch | undefined {
	const lower = buffer.toLowerCase();
	let earliest: TagMatch | undefined;
	for (const pair of TAG_PAIRS) {
		const idx = lower.indexOf(pair.open);
		if (idx >= 0) {
			if (!earliest || idx < earliest.index || (idx === earliest.index && pair.open.length > earliest.length)) {
				earliest = { index: idx, length: pair.open.length, pair };
			}
		}
	}
	return earliest;
}

interface CloseMatch {
	readonly index: number;
	readonly length: number;
}

function findEarliestCloseTag(buffer: string, activePair?: TagPair): CloseMatch | undefined {
	const lower = buffer.toLowerCase();
	const closeTags = activePair
		? [activePair.close, ...ALL_CLOSE_TAGS.filter((c) => c !== activePair.close)]
		: ALL_CLOSE_TAGS;
	let earliest: CloseMatch | undefined;
	for (const close of closeTags) {
		const idx = lower.indexOf(close);
		if (idx >= 0) {
			if (!earliest || idx < earliest.index || (idx === earliest.index && close.length > earliest.length)) {
				earliest = { index: idx, length: close.length };
			}
		}
	}
	return earliest;
}

/**
 * Some OpenAI-compatible gateways leak reasoning summaries into `delta.content`
 * wrapped in `<think>...</think>` or `<thinking>...</thinking>` instead of putting them in
 * `reasoning_content` (observed on DeepSeek, 567api, vetta-go GPT models: reasoning summaries
 * or CoT are inlined as tagged text).
 * Without this the tags render as literal body text.
 *
 * Stripping is only allowed while the message has not produced any real text yet,
 * so a model legitimately writing `<think>`/`<thinking>` inside its answer is left alone.
 */
export class ThinkingTagSplitter {
	private buffer = "";
	private inThinking = false;
	private activePair?: TagPair;
	private sawText = false;

	push(delta: string): ThinkingTagSegment[] {
		this.buffer += delta;
		const segments: ThinkingTagSegment[] = [];

		while (this.buffer.length > 0) {
			if (this.inThinking) {
				const closeMatch = findEarliestCloseTag(this.buffer, this.activePair);
				if (closeMatch) {
					this.emit(segments, "thinking", this.buffer.slice(0, closeMatch.index));
					this.buffer = this.buffer.slice(closeMatch.index + closeMatch.length);
					this.inThinking = false;
					this.activePair = undefined;
					continue;
				}
				const hold = partialTagSuffixLength(this.buffer, ALL_CLOSE_TAGS);
				this.emit(segments, "thinking", this.buffer.slice(0, this.buffer.length - hold));
				this.buffer = this.buffer.slice(this.buffer.length - hold);
				break;
			}

			if (this.sawText) {
				this.emit(segments, "text", this.buffer);
				this.buffer = "";
				break;
			}

			const openMatch = findEarliestOpenTag(this.buffer);
			if (openMatch) {
				const preceding = this.buffer.slice(0, openMatch.index);
				this.emit(segments, "text", preceding);
				if (this.sawText) {
					// Real text preceded the tag: keep the tag verbatim.
					this.emit(segments, "text", this.buffer.slice(openMatch.index, openMatch.index + openMatch.length));
				} else {
					this.inThinking = true;
					this.activePair = openMatch.pair;
				}
				this.buffer = this.buffer.slice(openMatch.index + openMatch.length);
				continue;
			}

			const hold = partialTagSuffixLength(this.buffer, ALL_OPEN_TAGS);
			this.emit(segments, "text", this.buffer.slice(0, this.buffer.length - hold));
			this.buffer = this.buffer.slice(this.buffer.length - hold);
			break;
		}

		return segments;
	}

	/** Emits whatever is still held back (an unterminated or partial tag) as-is. */
	flush(): ThinkingTagSegment[] {
		const segments: ThinkingTagSegment[] = [];
		this.emit(segments, this.inThinking ? "thinking" : "text", this.buffer);
		this.buffer = "";
		this.inThinking = false;
		this.activePair = undefined;
		return segments;
	}

	private emit(segments: ThinkingTagSegment[], kind: "text" | "thinking", text: string): void {
		if (text.length === 0) return;
		if (kind === "text" && text.trim().length > 0) this.sawText = true;
		const last = segments[segments.length - 1];
		if (last?.kind === kind) last.text += text;
		else segments.push({ kind, text });
	}
}
