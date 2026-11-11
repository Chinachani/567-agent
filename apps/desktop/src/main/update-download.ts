import type { DownloadOptions } from "builder-util-runtime";
import { CancellationError } from "builder-util-runtime";
import { type FileFetch, LegacyDownloadRequired, RangeFileDownloader } from "./downloads/range-download.js";

export type UpdateFetch = FileFetch;

/** Preserve metadata, differential transfer, checksums and platform installation. */
export class UpdateDownloader {
	private readonly downloader: RangeFileDownloader;
	constructor(cacheRoot: string, fetch: UpdateFetch) {
		this.downloader = new RangeFileDownloader(cacheRoot, fetch);
	}
	async download(url: URL, destination: string, options: DownloadOptions): Promise<string> {
		if (!options.sha512 && !options.sha2) throw new Error("An update checksum is required");
		const controller = new AbortController();
		const cancel = () => controller.abort(new CancellationError());
		if (options.cancellationToken.cancelled) throw new CancellationError();
		options.cancellationToken.on("cancel", cancel);
		try {
			const headers = new Headers();
			for (const [name, value] of Object.entries(options.headers ?? {})) {
				if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
			}
			return await this.downloader.download(url, destination, {
				signal: controller.signal,
				sha512: options.sha512 ?? undefined,
				sha2: options.sha2 ?? undefined,
				maxBytes: 8 * 1024 * 1024 * 1024,
				headers,
				onProgress: options.onProgress,
			});
		} finally {
			options.cancellationToken.off("cancel", cancel);
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
