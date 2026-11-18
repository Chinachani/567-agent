import type { RemoteInputMessage } from "@567agent/remote-desktop";

type Edge = Extract<RemoteInputMessage, { type: "key" | "pointer.button" }>;

/** Track only remote downs. A retired route cannot release a key still held by another route. */
export class RemoteInputOwnership {
	private readonly held = new Map<string, { owners: Set<number>; edge: Edge }>();

	constructor(private readonly deliver: (message: RemoteInputMessage) => void) {}

	apply(owner: number, message: RemoteInputMessage): void {
		if (message.type === "pointer.move" || message.type === "pointer.button") {
			for (const item of this.held.values()) {
				if (item.edge.type === "pointer.button" && item.owners.has(owner))
					item.edge = { ...item.edge, x: message.x, y: message.y };
			}
		}
		if (message.type !== "key" && message.type !== "pointer.button") {
			this.deliver(message);
			return;
		}
		const key = message.type === "key" ? `key:${message.code}` : `mouse:${message.button}`;
		const current = this.held.get(key);
		if (message.action === "down") {
			if (!current) {
				// Key codes on the wire are strings. Bound remote downs, never their releases.
				if (this.held.size >= 128) return;
				this.deliver(message);
				this.held.set(key, { edge: message, owners: new Set([owner]) });
			} else if (!current.owners.has(owner)) current.owners.add(owner);
			else if (message.type === "key") this.deliver(message); // Physical key repeat.
		} else if (current?.owners.has(owner)) {
			if (current.owners.size === 1) this.deliver(message);
			current.owners.delete(owner);
			if (!current.owners.size) this.held.delete(key);
		}
	}

	release(owner: number): void {
		for (const [key, item] of [...this.held].reverse()) {
			if (!item.owners.delete(owner) || item.owners.size) continue;
			this.held.delete(key);
			try {
				this.deliver({ ...item.edge, action: "up" });
			} catch {
				/* Keep releasing other keys on teardown. */
			}
		}
	}
}
