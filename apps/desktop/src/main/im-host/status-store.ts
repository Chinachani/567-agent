import type { StatusEvent, TransportStatus } from "./host-protocol.js";

/**
 * The current health snapshot of the IM bridge sidecar. Updated from
 * stdout events (status, metric) and exposed to renderer via IPC.
 */
export interface ImBridgeStatus {
	transport: TransportStatus;
	channelStatuses?: StatusEvent["channelStatuses"];
	lastError?: string;
	lastErrorAt?: string;
	activeSessions: number;
	sidecarPid?: number;
	sidecarStartedAt?: string;
	consecutiveStartFailures: number;
	binaryPath?: string;
}

export function defaultStatus(): ImBridgeStatus {
	return {
		transport: "offline",
		activeSessions: 0,
		consecutiveStartFailures: 0,
	};
}

/**
 * In-memory pub/sub for status snapshots. Subscribers receive a copy of
 * the current snapshot whenever any field changes.
 */
export class StatusStore {
	private state: ImBridgeStatus = defaultStatus();
	private subscribers = new Set<(snapshot: ImBridgeStatus) => void>();

	get(): ImBridgeStatus {
		const { channelStatuses } = this.state;
		return { ...this.state, ...(channelStatuses && { channelStatuses: { ...channelStatuses } }) };
	}

	applyStatusEvent(event: StatusEvent): void {
		this.patch({
			transport: event.transport,
			channelStatuses: event.channelStatuses ? { ...event.channelStatuses } : undefined,
			lastError: event.lastError,
			lastErrorAt: event.lastError ? event.time : undefined,
		});
	}

	patch(update: Partial<ImBridgeStatus>): void {
		this.state = { ...this.state, ...update };
		const snap = this.get();
		for (const sub of this.subscribers) {
			try {
				sub(snap);
			} catch {
				// ignore
			}
		}
	}

	subscribe(handler: (snapshot: ImBridgeStatus) => void): () => void {
		this.subscribers.add(handler);
		return () => {
			this.subscribers.delete(handler);
		};
	}

	reset(): void {
		this.state = defaultStatus();
	}
}
