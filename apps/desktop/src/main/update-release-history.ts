import type { UpdateReleaseHistory, UpdateReleaseNote } from "../shared/updater-preferences.js";

export const RELEASES_PAGE = "https://github.com/Chinachani/567-agent/releases";
const RELEASES_API = "https://api.github.com/repos/Chinachani/567-agent/releases?per_page=100";

/** Public stable releases only. This list never controls updater assets or the download feed. */
export class UpdateReleaseHistoryService {
	private cached: { at: number; releases: UpdateReleaseNote[] } | null = null;
	private pending: Promise<UpdateReleaseNote[]> | null = null;
	constructor(
		private readonly baselineVersion: string,
		private readonly fetcher: typeof fetch = fetch,
	) {}

	async get(): Promise<UpdateReleaseHistory> {
		if (this.cached && Date.now() - this.cached.at < 5 * 60_000) {
			return { baselineVersion: this.baselineVersion, releases: this.cached.releases };
		}
		this.pending ??= this.load().finally(() => {
			this.pending = null;
		});
		return { baselineVersion: this.baselineVersion, releases: await this.pending };
	}

	private async load(): Promise<UpdateReleaseNote[]> {
		const response = await this.fetcher(RELEASES_API, {
			headers: { Accept: "application/vnd.github+json" },
			signal: AbortSignal.timeout(15_000),
			redirect: "error",
		});
		if (!response.ok) throw new Error(`Release history HTTP ${response.status}`);
		// Read with a bound even when Content-Length is absent.
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Release history response missing");
		let size = 0;
		const chunks: Uint8Array[] = [];
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > 4 * 1024 * 1024) throw new Error("Release history response too large");
				chunks.push(value);
			}
		} finally {
			await reader.cancel();
			reader.releaseLock();
		}
		const buffer = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			buffer.set(chunk, offset);
			offset += chunk.length;
		}
		const value: unknown = JSON.parse(new TextDecoder().decode(buffer));
		if (!Array.isArray(value)) throw new Error("Invalid release history");
		const releases: UpdateReleaseNote[] = value.slice(0, 100).flatMap((entry) => {
			if (
				!entry ||
				typeof entry !== "object" ||
				entry.draft ||
				entry.prerelease ||
				typeof entry.tag_name !== "string"
			)
				return [];
			const version = /^v?(\d+\.\d+\.\d+)$/.exec(entry.tag_name)?.[1];
			if (!version || entry.html_url !== `${RELEASES_PAGE}/tag/${entry.tag_name}`) return [];
			return [
				{
					version,
					url: entry.html_url,
					body: typeof entry.body === "string" ? entry.body.slice(0, 100_000) : "",
					publishedAt: typeof entry.published_at === "string" ? entry.published_at : "",
				},
			];
		});
		this.cached = { at: Date.now(), releases };
		return releases;
	}
}
