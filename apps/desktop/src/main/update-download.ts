import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { DownloadOptions } from "builder-util-runtime";
import { CancellationError } from "builder-util-runtime";

const MIN_PARALLEL_BYTES = 4 * 1024 * 1024;
const MAX_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_WORKERS = 4;
const READ_TIMEOUT_MS = 30_000;
const RETRIES = 3;

export type UpdateFetch = (url: string, init: RequestInit) => Promise<Response>;

class RangeUnsupportedError extends Error {}
class LegacyDownloadRequired extends Error {}

function safeUrl(value: string): URL {
	const url = new URL(value);
	const local = url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
	if ((!local && url.protocol !== "https:") || url.username || url.password) {
		throw new Error("Update downloads require HTTPS without URL credentials");
	}
	return url;
}

function range(value: string | null): { start: number; end: number; total: number } | null {
	const match = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(value ?? "");
	if (!match) return null;
	const [start, end, total] = match.slice(1).map(Number);
	if (
		![start, end, total].every(Number.isSafeInteger) ||
		start < 0 ||
		end < start ||
		total <= end ||
		total > MAX_BYTES
	)
		return null;
	return { start, end, total };
}

async function fileSize(path: string): Promise<number> {
	return stat(path).then(
		(info) => info.size,
		() => 0,
	);
}

/** Keep the updater's metadata, differential downloads and installation; replace full-file transport only. */
export class UpdateDownloader {
	private pending: Promise<void> = Promise.resolve();
	constructor(
		private readonly cacheRoot: string,
		private readonly fetch: UpdateFetch,
	) {}

	async download(url: URL, destination: string, options: DownloadOptions): Promise<string> {
		const previous = this.pending;
		let release!: () => void;
		this.pending = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		try {
			return await this.runDownload(url, destination, options);
		} finally {
			release();
		}
	}

	private async runDownload(url: URL, destination: string, options: DownloadOptions): Promise<string> {
		const digest = options.sha512 ?? options.sha2;
		if (!digest) throw new Error("An update checksum is required");
		safeUrl(url.href);
		const key = createHash("sha256")
			.update(`${url.href}\n${options.sha512 ?? ""}\n${options.sha2 ?? ""}`)
			.digest("hex");
		const directory = join(this.cacheRoot, key);
		await mkdir(directory, { recursive: true });
		const controller = new AbortController();
		const cancel = () => controller.abort(new CancellationError());
		if (options.cancellationToken.cancelled) throw new CancellationError();
		options.cancellationToken.on("cancel", cancel);
		const startedAt = Date.now();
		let total = 0;
		let transferred = 0;
		let networkBytes = 0;
		let lastBytes = 0;
		const progress = () => {
			controller.signal.throwIfAborted();
			const delta = Math.max(0, transferred - lastBytes);
			lastBytes = transferred;
			options.onProgress?.({
				total,
				transferred,
				delta,
				percent: total ? Math.min(100, (transferred / total) * 100) : 0,
				bytesPerSecond: Math.round((networkBytes * 1000) / Math.max(1, Date.now() - startedAt)),
			});
		};
		const headers = new Headers();
		for (const [name, value] of Object.entries(options.headers ?? {})) {
			if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
		}
		headers.set("Accept-Encoding", "identity");
		const request = async (
			start?: number,
			end?: number,
		): Promise<{ response: Response; touch: () => void; dispose: () => void }> => {
			let current = safeUrl(url.href);
			const currentHeaders = new Headers(headers);
			if (start !== undefined) currentHeaders.set("Range", `bytes=${start}-${end ?? ""}`);
			const timeoutController = new AbortController();
			let timeout: NodeJS.Timeout | undefined;
			const touch = () => {
				clearTimeout(timeout);
				timeout = setTimeout(() => timeoutController.abort(new Error("Update download stalled")), READ_TIMEOUT_MS);
			};
			const signal = AbortSignal.any([controller.signal, timeoutController.signal]);
			touch();
			for (let redirects = 0; redirects <= 8; redirects++) {
				let response: Response;
				try {
					response = await this.fetch(current.href, {
						headers: currentHeaders,
						signal,
						redirect: "manual",
						credentials: "omit",
					});
				} catch (error) {
					clearTimeout(timeout);
					throw error;
				}
				if ([301, 302, 303, 307, 308].includes(response.status)) {
					await response.body?.cancel();
					const location = response.headers.get("location");
					if (!location) {
						clearTimeout(timeout);
						throw new Error("Update redirect has no destination");
					}
					let next: URL;
					try {
						next = safeUrl(new URL(location, current).href);
						if (current.protocol === "https:" && next.protocol !== "https:")
							throw new Error("Update redirect downgraded HTTPS");
					} catch (error) {
						clearTimeout(timeout);
						throw error;
					}
					if (next.origin !== current.origin) {
						// A mirror redirect must not forward custom authorization headers to its CDN.
						for (const name of [...currentHeaders.keys()])
							if (!["range", "accept-encoding", "user-agent", "accept"].includes(name))
								currentHeaders.delete(name);
					}
					current = next;
					continue;
				}
				return {
					response,
					touch,
					dispose: () => {
						clearTimeout(timeout);
						void response.body?.cancel().catch(() => {});
					},
				};
			}
			clearTimeout(timeout);
			throw new Error("Too many update download redirects");
		};
		const transfer = async (path: string, start: number, end: number, segmented: boolean): Promise<void> => {
			for (let attempt = 0; attempt < RETRIES; attempt++) {
				controller.signal.throwIfAborted();
				const offset = await fileSize(path);
				if (offset === end - start + 1) return;
				try {
					const { response, touch, dispose } = await request(
						offset > 0 || segmented ? start + offset : undefined,
						segmented ? end : undefined,
					);
					try {
						const contentRange = range(response.headers.get("content-range"));
						if (segmented && response.status !== 206) throw new RangeUnsupportedError();
						if (response.status !== 200 && response.status !== 206)
							throw new Error(`Update download HTTP ${response.status}`);
						if (
							response.status === 206 &&
							(!contentRange ||
								contentRange.start !== start + offset ||
								contentRange.total !== total ||
								contentRange.end > end)
						)
							throw new Error("Invalid update byte range");
						const reset = response.status === 200;
						if (reset) transferred -= offset;
						const handle = await open(path, reset ? "w" : "a");
						let saved = reset ? 0 : offset;
						const reader = response.body?.getReader();
						try {
							if (!reader) throw new Error("Update response has no body");
							while (true) {
								const result = await reader.read();
								if (result.done) break;
								const chunk = result.value;
								touch();
								controller.signal.throwIfAborted();
								saved += chunk.byteLength;
								if (saved > end - start + 1) throw new Error("Update response exceeds the requested size");
								let written = 0;
								while (written < chunk.byteLength) {
									const result = await handle.write(chunk, written, chunk.byteLength - written);
									if (!result.bytesWritten) throw new Error("Unable to write update segment");
									written += result.bytesWritten;
								}
								transferred += chunk.byteLength;
								networkBytes += chunk.byteLength;
								progress();
							}
						} finally {
							await reader?.cancel().catch(() => {});
							reader?.releaseLock();
							await handle.close();
						}
						if (saved !== end - start + 1) throw new Error("Update response ended early");
						return;
					} finally {
						dispose();
					}
				} catch (error) {
					if (controller.signal.aborted) controller.signal.throwIfAborted();
					if (error instanceof RangeUnsupportedError || attempt === RETRIES - 1) throw error;
				}
			}
		};
		try {
			const { response, dispose } = await request(0, 0);
			let supportsRanges: boolean;
			try {
				const metadata = range(response.headers.get("content-range"));
				supportsRanges = response.status === 206 && metadata?.start === 0 && metadata.end === 0;
				total = supportsRanges && metadata ? metadata.total : Number(response.headers.get("content-length"));
				if ((response.status === 200 && !response.headers.has("content-length")) || response.status === 416) {
					throw new LegacyDownloadRequired();
				}
				if (
					![200, 206].includes(response.status) ||
					!Number.isSafeInteger(total) ||
					total <= 0 ||
					total > MAX_BYTES
				)
					throw new Error("Invalid update package size");
			} finally {
				dispose();
			}
			let paths: string[];
			if (supportsRanges && total >= MIN_PARALLEL_BYTES) {
				paths = Array.from({ length: MAX_WORKERS }, (_, index) => join(directory, `${index}.part`));
				for (let index = 0; index < MAX_WORKERS; index++) {
					const length =
						Math.floor((total * (index + 1)) / MAX_WORKERS) - Math.floor((total * index) / MAX_WORKERS);
					if ((await fileSize(paths[index])) > length) await rm(paths[index], { force: true });
					transferred += await fileSize(paths[index]);
				}
				progress();
				// Wait for all workers before falling back, so none can still write the discarded pieces.
				const outcomes = await Promise.allSettled(
					paths.map((path, index) =>
						transfer(
							path,
							Math.floor((total * index) / MAX_WORKERS),
							Math.floor((total * (index + 1)) / MAX_WORKERS) - 1,
							true,
						),
					),
				);
				const failed = outcomes.find((outcome) => outcome.status === "rejected");
				if (failed?.status === "rejected") {
					if (!(failed.reason instanceof RangeUnsupportedError)) throw failed.reason;
					supportsRanges = false;
				}
			} else paths = [];
			if (!supportsRanges || paths.length === 0) {
				paths = [join(directory, "single.part")];
				if ((await fileSize(paths[0])) > total) await rm(paths[0], { force: true });
				transferred = await fileSize(paths[0]);
				progress();
				await transfer(paths[0], 0, total - 1, false);
			}
			controller.signal.throwIfAborted();
			const assembled = join(directory, "assembled");
			const output = await open(assembled, "w");
			const sha512 = createHash("sha512");
			const sha256 = createHash("sha256");
			try {
				for (const path of paths)
					for await (const chunk of createReadStream(path)) {
						controller.signal.throwIfAborted();
						sha512.update(chunk);
						sha256.update(chunk);
						let offset = 0;
						while (offset < chunk.length) {
							const result = await output.write(chunk, offset, chunk.length - offset);
							if (!result.bytesWritten) throw new Error("Unable to assemble update");
							offset += result.bytesWritten;
						}
					}
			} finally {
				await output.close();
			}
			const actual512 = sha512.digest("base64");
			const actual256 = sha256.digest("hex");
			if ((options.sha512 && options.sha512 !== actual512) || (options.sha2 && options.sha2 !== actual256)) {
				await rm(directory, { recursive: true, force: true });
				throw new Error("Update package checksum mismatch");
			}
			controller.signal.throwIfAborted();
			await rm(destination, { force: true });
			// The user-selected Windows update cache can be on a different volume.
			// This is electron-updater's temporary path; it promotes only after this returns.
			await copyFile(assembled, destination);
			controller.signal.throwIfAborted();
			await rm(directory, { recursive: true, force: true });
			return destination;
		} finally {
			options.cancellationToken.off("cancel", cancel);
			controller.abort();
		}
	}
}

export interface UpdaterDownloadExecutor {
	download(url: URL, destination: string, options: DownloadOptions): Promise<string>;
}

export function installUpdateDownloader(executor: UpdaterDownloadExecutor, downloader: UpdateDownloader): void {
	const original = executor.download.bind(executor);
	executor.download = (url, destination, options) => {
		if (!options.sha512 && !options.sha2) return original(url, destination, options);
		return downloader.download(url, destination, options).catch((error: unknown) => {
			if (error instanceof LegacyDownloadRequired) return original(url, destination, options);
			throw error;
		});
	};
}
