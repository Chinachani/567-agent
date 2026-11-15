import { z } from "zod";

export const REMOTE_CAPTURE_HELPER_SWITCH = "--567-remote-capture-helper";
export const REMOTE_CAPTURE_PROFILE_ENV = "AGENT567_REMOTE_CAPTURE_PROFILE";

const envelope = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("request"),
		id: z.number().int().positive(),
		method: z.string().max(64),
		value: z.unknown(),
	}),
	z.object({ kind: z.literal("reply"), id: z.number().int().positive(), ok: z.boolean(), value: z.unknown() }),
	z.object({ kind: z.literal("event"), method: z.string().max(64), value: z.unknown() }),
]);

/** Private, inherited Node IPC only. Neither credentials nor frames go to argv or logs. */
export class RemoteCaptureChannel {
	private sequence = 0;
	private closed = false;
	private readonly pending = new Map<
		number,
		{ resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
	>();
	onRequest: (method: string, value: unknown) => Promise<unknown> = async () => {
		throw new Error("Unsupported capture request");
	};
	onEvent: (method: string, value: unknown) => void = () => {};

	constructor(private readonly send: (value: z.infer<typeof envelope>) => void) {}

	request(method: string, value: unknown, timeoutMs = 30_000): Promise<unknown> {
		if (this.closed) return Promise.reject(new Error("Capture process disconnected"));
		const id = ++this.sequence;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error("Capture process request timed out"));
			}, timeoutMs);
			this.pending.set(id, { resolve, reject, timer });
			try {
				this.send({ kind: "request", id, method, value });
			} catch {
				this.close();
			}
		});
	}

	event(method: string, value: unknown): void {
		if (this.closed) return;
		try {
			this.send({ kind: "event", method, value });
		} catch {
			this.close();
		}
	}

	receive(value: unknown): void {
		if (this.closed) return;
		const parsed = envelope.safeParse(value);
		if (!parsed.success) return;
		const message = parsed.data;
		if (message.kind === "reply") {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.ok) pending.resolve(message.value);
			else pending.reject(new Error("Capture process request failed"));
		} else if (message.kind === "event") {
			this.onEvent(message.method, message.value);
		} else {
			void Promise.resolve()
				.then(() => this.onRequest(message.method, message.value))
				.then(
					(result) => this.reply(message.id, true, result),
					() => this.reply(message.id, false, null),
				);
		}
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error("Capture process disconnected"));
		}
		this.pending.clear();
	}

	private reply(id: number, ok: boolean, value: unknown): void {
		if (this.closed) return;
		try {
			this.send({ kind: "reply", id, ok, value });
		} catch {
			this.close();
		}
	}
}
