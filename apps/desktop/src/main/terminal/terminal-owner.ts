import type { WebContents } from "electron";
import { type OpenTerminalRequest, type OpenTerminalResult, TERMINAL_CHANNELS } from "../../shared/terminal-ipc.js";
import { TerminalSnapshotStore } from "./snapshot-store.js";
import { TerminalService } from "./terminal-service.js";

const owners = new Set<TerminalOwner>();
export function disposeAllTerminals(): void {
	for (const owner of [...owners]) owner.dispose();
}

/** A renderer owns its terminals, including opens that have not completed yet. */
export class TerminalOwner {
	readonly service = new TerminalService();
	readonly snapshots = new TerminalSnapshotStore();
	private readonly subscriptions = new Map<string, () => void>();
	private disposed = false;
	private generation = 0;
	private readonly release = () => {
		this.generation += 1;
		for (const stop of this.subscriptions.values()) stop();
		this.subscriptions.clear();
		this.service.disposeOwnedBy(this.sender.id);
	};
	private readonly destroyed = () => this.dispose();
	constructor(private readonly sender: WebContents) {
		owners.add(this);
		sender.on("did-navigate", this.release);
		sender.on("render-process-gone", this.release);
		sender.once("destroyed", this.destroyed);
	}
	async open(request: OpenTerminalRequest): Promise<OpenTerminalResult> {
		if (this.disposed || this.sender.isDestroyed()) throw new Error("Terminal owner is unavailable");
		const generation = this.generation;
		const result = await this.service.open(this.sender.id, request);
		if (this.disposed || this.sender.isDestroyed() || generation !== this.generation) {
			this.service.dispose(result.terminalId);
			throw new Error("Terminal owner is unavailable");
		}
		return result;
	}
	attach(id: string): void {
		if (this.disposed || this.sender.isDestroyed()) throw new Error("Terminal owner is unavailable");
		if (this.subscriptions.has(id)) return;
		const session = this.service.get(id);
		if (!session) throw new Error("Terminal was closed during startup");
		let deliveryFailed = false;
		const stop = session.attach((event) => {
			if (deliveryFailed) return;
			try {
				this.sender.send(TERMINAL_CHANNELS.EVENT, { terminalId: id, event });
			} catch {
				deliveryFailed = true;
				this.close(id);
			}
		});
		if (deliveryFailed || this.disposed || this.sender.isDestroyed()) {
			stop();
			this.close(id);
			throw new Error("Terminal owner is unavailable");
		}
		this.subscriptions.set(id, stop);
	}

	close(id: string): void {
		this.subscriptions.get(id)?.();
		this.subscriptions.delete(id);
		this.service.dispose(id);
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		owners.delete(this);
		this.release();
		this.sender.removeListener("did-navigate", this.release);
		this.sender.removeListener("render-process-gone", this.release);
		this.sender.removeListener("destroyed", this.destroyed);
	}
}
