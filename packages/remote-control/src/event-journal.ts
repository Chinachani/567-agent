import type { RemoteEvent, RemoteEventName } from "./types.js";

export interface RemoteEventInput {
	readonly name: RemoteEventName;
	readonly sessionId?: string;
	readonly payload?: unknown;
}

/**
 * Keeps the small, in-memory replay window shared by successive transport
 * connections for one paired desktop target. The journal deliberately holds
 * protocol payloads only; conversation history remains the durable source of
 * truth and is read through session.history/session.turn.read.
 */
export class RemoteEventJournal {
	private nextSequence = 0;
	private readonly events = new Map<number, RemoteEvent>();
	private readonly maxEvents: number;

	constructor(
		readonly publisherId: string,
		maxEvents = 256,
	) {
		if (!/^[A-Za-z0-9._:-]{1,256}$/.test(publisherId)) throw new Error("Invalid remote event publisher id");
		if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 4096) {
			throw new Error("Invalid remote event journal size");
		}
		this.maxEvents = maxEvents;
	}

	get sequence(): number {
		return this.nextSequence;
	}

	append(input: RemoteEventInput): RemoteEvent {
		const sequence = ++this.nextSequence;
		const event: RemoteEvent = {
			type: "event",
			eventId: `${this.publisherId}-event-${sequence}`,
			sequence,
			name: input.name,
			...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
			...(input.payload === undefined ? {} : { payload: input.payload }),
		};
		this.events.set(sequence, event);
		while (this.events.size > this.maxEvents) {
			const oldest = this.events.keys().next().value;
			if (oldest === undefined) break;
			this.events.delete(oldest);
		}
		return event;
	}

	after(sequence: number): readonly RemoteEvent[] {
		if (!Number.isSafeInteger(sequence) || sequence < 0) return [];
		return [...this.events].filter(([candidate]) => candidate > sequence).map(([, event]) => event);
	}

	acknowledge(sequence: number): void {
		if (!Number.isSafeInteger(sequence) || sequence < 1) return;
		for (const candidate of this.events.keys()) {
			if (candidate <= sequence) this.events.delete(candidate);
		}
	}
}
