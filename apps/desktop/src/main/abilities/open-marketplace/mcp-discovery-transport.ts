import { setTimeout as delay } from "node:timers/promises";
import type { OpenMarketplaceDiscoveryStatus } from "../../../preload/api-types/abilities.js";
export type DiscoveryErrorCode = NonNullable<OpenMarketplaceDiscoveryStatus["error"]>;
export class DiscoveryError extends Error {
	constructor(
		readonly code: DiscoveryErrorCode,
		message: string,
	) {
		super(message);
	}
}
export function discoveryErrorCode(error: unknown): DiscoveryErrorCode {
	return error instanceof DiscoveryError ? error.code : "content-invalid";
}
export interface DiscoveryTransportOptions {
	fetch: (url: string, init?: RequestInit) => Promise<Response>;
	timeoutMs?: number;
	retryDelayMs?: number;
}
/** A single feed owns four slots across index, search and detail requests. */
export class DiscoveryTransport {
	private active = 0;
	private readonly waiting = new Set<() => void>();
	constructor(private readonly options: DiscoveryTransportOptions) {}
	private async slot(signal: AbortSignal): Promise<() => void> {
		while (this.active >= 4) {
			await new Promise<void>((resolve, reject) => {
				const wake = () => {
					signal.removeEventListener("abort", abort);
					this.waiting.delete(wake);
					resolve();
				};
				const abort = () => {
					this.waiting.delete(wake);
					reject(signal.reason);
				};
				signal.addEventListener("abort", abort, { once: true });
				this.waiting.add(wake);
				if (signal.aborted) abort();
			});
		}
		signal.throwIfAborted();
		this.active++;
		return () => {
			this.active--;
			this.waiting.values().next().value?.();
		};
	}
	async download(url: string, limit: number, signal = new AbortController().signal): Promise<Buffer> {
		const release = await this.slot(signal);
		try {
			for (let attempt = 0; ; attempt++) {
				signal.throwIfAborted();
				const timeout = new AbortController();
				const timer = setTimeout(() => timeout.abort(), this.options.timeoutMs ?? 30_000);
				try {
					const response = await this.options.fetch(url, {
						headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "567-Agent-Desktop" },
						signal: AbortSignal.any([signal, timeout.signal]),
						redirect: "error",
					});
					if (!response.ok) {
						await response.body?.cancel();
						throw new DiscoveryError(
							response.status === 404
								? "not-found"
								: response.status === 429
									? "rate-limited"
									: [401, 403].includes(response.status)
										? "forbidden"
										: "network",
							`Discovery HTTP ${response.status}`,
						);
					}
					if (Number(response.headers.get("content-length")) > limit) {
						await response.body?.cancel();
						throw new DiscoveryError("content-invalid", "Discovery response exceeds byte limit");
					}
					const reader = response.body?.getReader();
					if (!reader) return Buffer.alloc(0);
					const chunks: Uint8Array[] = [];
					let size = 0;
					try {
						for (;;) {
							const part = await reader.read();
							if (part.done) break;
							size += part.value.byteLength;
							if (size > limit)
								throw new DiscoveryError("content-invalid", "Discovery response exceeds byte limit");
							chunks.push(part.value);
						}
					} catch (error) {
						await reader.cancel().catch(() => undefined);
						throw error;
					} finally {
						reader.releaseLock();
					}
					signal.throwIfAborted();
					return Buffer.concat(chunks, size);
				} catch (cause) {
					signal.throwIfAborted();
					const error = timeout.signal.aborted
						? new DiscoveryError("timeout", "Discovery timed out")
						: cause instanceof DiscoveryError
							? cause
							: new DiscoveryError("network", "Discovery connection failed");
					if (attempt >= 1 || !["network", "timeout", "rate-limited"].includes(error.code)) throw error;
				} finally {
					clearTimeout(timer);
				}
				await delay(this.options.retryDelayMs ?? 500, undefined, { signal });
			}
		} finally {
			release();
		}
	}
}
