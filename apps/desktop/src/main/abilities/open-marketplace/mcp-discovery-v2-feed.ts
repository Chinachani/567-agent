import { mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as yieldTask } from "node:timers/promises";
import {
	discoveryFacetsMatch,
	discoveryRecordMatches,
	emptyDiscoveryFacets,
	type McpDiscoveryProgress,
	type McpDiscoveryQuery,
	type McpDiscoveryReference,
} from "../../../shared/mcp-discovery.js";
import { DiscoveryFileCache, writeDiscoveryCache } from "./mcp-discovery-cache.js";
import { verifyMcpDiscoveryShard } from "./mcp-discovery-catalog.js";
import {
	DiscoveryError,
	DiscoveryTransport,
	type DiscoveryTransportOptions,
	discoveryErrorCode,
} from "./mcp-discovery-transport.js";
import {
	addFacets,
	assertEqualFacets,
	type DiscoveryAbilityV2,
	type DiscoveryCategory,
	type DiscoveryEntryV2,
	type DiscoveryFileRef,
	type DiscoveryIndexV2,
	type DiscoveryPageV2,
	parseDiscoveryDataV2,
	parseDiscoveryIndexV2,
	parseDiscoveryPageV2,
	V2_INDEX_BYTES,
} from "./mcp-discovery-v2-schema.js";

export interface PinnedDiscoveryV2 {
	revision: string;
	index: DiscoveryIndexV2;
}
export type DiscoveryResultRow = { ability: DiscoveryAbilityV2; reference: McpDiscoveryReference };
export interface DiscoverySearchResult {
	rows: DiscoveryResultRow[];
	progress: McpDiscoveryProgress;
}
interface Options extends DiscoveryTransportOptions {
	rootDir: string;
	repository: string;
	cacheBudgetBytes?: number;
}
/** Index state is independent of search jobs. Refresh never changes an in-flight job's revision. */
export class McpDiscoveryV2Feed {
	private current: PinnedDiscoveryV2 | null = null;
	private restore: Promise<PinnedDiscoveryV2 | null> | undefined;
	private readonly detailRequests = new Map<string, Promise<DiscoveryAbilityV2[]>>();
	private readonly root: string;
	private readonly coordinates: string;
	private readonly transport: DiscoveryTransport;
	private readonly cache: DiscoveryFileCache;
	constructor(options: Options) {
		const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/?$/.exec(options.repository);
		if (!match) throw new Error("Invalid discovery repository");
		this.coordinates = match[1];
		this.root = join(options.rootDir, "discovery-v2");
		this.transport = new DiscoveryTransport(options);
		this.cache = new DiscoveryFileCache(this.root, this.coordinates, options.cacheBudgetBytes);
	}
	private url(revision: string, path: string): string {
		return `https://raw.githubusercontent.com/${this.coordinates}/${revision}/${path}`;
	}
	private async readRoot(name: string): Promise<PinnedDiscoveryV2 | null> {
		try {
			const path = join(this.root, name);
			if ((await stat(path)).size > V2_INDEX_BYTES * 2) return null;
			const raw: unknown = JSON.parse(await readFile(path, "utf8"));
			if (
				!raw ||
				typeof raw !== "object" ||
				!("revision" in raw) ||
				typeof raw.revision !== "string" ||
				!/^[a-f0-9]{40}$/.test(raw.revision) ||
				!("index" in raw)
			)
				return null;
			return { revision: raw.revision, index: parseDiscoveryIndexV2(raw.index) };
		} catch {
			return null;
		}
	}
	async cached(): Promise<PinnedDiscoveryV2 | null> {
		this.restore ??= (async () => {
			this.current = (await this.readRoot("active.json")) ?? (await this.readRoot("previous.json"));
			return this.current;
		})();
		await this.restore;
		return this.current;
	}
	async pinRevision(signal?: AbortSignal): Promise<string> {
		const raw: unknown = JSON.parse(
			(
				await this.transport.download(
					`https://api.github.com/repos/${this.coordinates}/git/ref/heads/catalog`,
					64 * 1024,
					signal,
				)
			).toString("utf8"),
		);
		const object = raw && typeof raw === "object" && "object" in raw ? raw.object : null;
		const revision = object && typeof object === "object" && "sha" in object ? object.sha : null;
		if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision))
			throw new DiscoveryError("content-invalid", "Invalid discovery revision");
		return revision;
	}
	async sync(revision: string, signal?: AbortSignal): Promise<PinnedDiscoveryV2> {
		const bytes = await this.transport.download(this.url(revision, "v2/index.json"), V2_INDEX_BYTES, signal);
		const next = { revision, index: parseDiscoveryIndexV2(JSON.parse(bytes.toString("utf8"))) };
		const previous = await this.cached();
		await mkdir(this.root, { recursive: true });
		if (previous && previous.revision !== revision)
			await writeDiscoveryCache(join(this.root, "previous.json"), JSON.stringify(previous));
		await writeDiscoveryCache(join(this.root, "active.json"), JSON.stringify(next));
		this.current = next;
		return next;
	}
	private async file<T>(
		pinned: PinnedDiscoveryV2,
		ref: DiscoveryFileRef,
		parse: (raw: unknown) => T,
		signal: AbortSignal,
	): Promise<T> {
		signal.throwIfAborted();
		const cached = await this.cache.read(pinned.revision, ref);
		if (cached) {
			try {
				return parse(JSON.parse(cached.toString("utf8")));
			} catch {
				/* Invalid cache never substitutes for verified content. */
			}
		}
		const bytes = await this.transport.download(this.url(pinned.revision, ref.path), ref.sizeBytes, signal);
		verifyMcpDiscoveryShard(bytes, ref);
		const result = parse(JSON.parse(bytes.toString("utf8")));
		signal.throwIfAborted();
		await this.cache.put(pinned.revision, ref, bytes).catch(() => undefined);
		return result;
	}
	private async *pages(pinned: PinnedDiscoveryV2, category: DiscoveryCategory, signal: AbortSignal) {
		const info = pinned.index.categories[category];
		if (!info) return;
		let next: DiscoveryFileRef | null = info.firstPage;
		const paths = new Set<string>();
		const shards = new Set<string>();
		let count = 0;
		let shardCount = 0;
		const facets = emptyDiscoveryFacets();
		while (next) {
			if (paths.has(next.path) || paths.size >= info.pageCount)
				throw new Error("Discovery page cycle/count mismatch");
			paths.add(next.path);
			const ref: DiscoveryFileRef = next;
			const page: DiscoveryPageV2 = await this.file(
				pinned,
				ref,
				(raw) => parseDiscoveryPageV2(raw, pinned.index, category),
				signal,
			);
			for (const entry of page.entries) {
				if (shards.has(entry.search.path) || shards.has(entry.detail.path))
					throw new Error("Duplicate discovery shard path");
				shards.add(entry.search.path);
				shards.add(entry.detail.path);
				count += entry.count;
				shardCount++;
				addFacets(facets, entry.facets);
				if (count > info.recordCount || shardCount > info.shardCount)
					throw new Error("Discovery declared counts exceeded");
			}
			next = page.next;
			yield { ref, page };
		}
		if (paths.size !== info.pageCount || shardCount !== info.shardCount || count !== info.recordCount)
			throw new Error("Discovery category count mismatch");
		assertEqualFacets(facets, info.facets);
	}
	async search(
		query: McpDiscoveryQuery,
		signal: AbortSignal,
		update: (result: DiscoverySearchResult) => void,
		excludedSlugs = new Set<string>(),
	): Promise<DiscoverySearchResult> {
		const pinned = await this.cached();
		if (!pinned) throw new Error("Discovery v2 is unavailable");
		const categories = Object.entries(pinned.index.categories).filter(
			([key, info]) =>
				(!query.category || query.category === key) && discoveryFacetsMatch(info.facets, query.filters),
		);
		const progress: McpDiscoveryProgress = {
			revision: pinned.revision,
			version: pinned.index.catalogVersion,
			matched: 0,
			scanned: 0,
			total: categories.reduce((sum, [, info]) => sum + info.recordCount, 0),
			running: true,
			complete: false,
			failures: [],
		};
		const rows: DiscoveryResultRow[] = [];
		const slugs = new Set<string>();
		let searchBytes = 0;
		let detailBytes = 0;
		let pageBytes = 0;
		const snapshot = (): DiscoverySearchResult => ({
			rows: [...rows],
			progress: { ...progress, failures: [...progress.failures] },
		});
		update(snapshot());
		for (const [name] of categories) {
			const category = name as DiscoveryCategory;
			let path = pinned.index.categories[category]?.firstPage.path ?? name;
			let lastSlug = "";
			try {
				for await (const { page, ref } of this.pages(pinned, category, signal)) {
					path = ref.path;
					pageBytes += ref.sizeBytes;
					for (const entry of page.entries) {
						searchBytes += entry.search.sizeBytes;
						detailBytes += entry.detail.sizeBytes;
					}
					for (let offset = 0; offset < page.entries.length; offset += 4) {
						const entries = page.entries.slice(offset, offset + 4);
						const parts = await Promise.allSettled(
							entries.map((entry) =>
								discoveryFacetsMatch(entry.facets, query.filters)
									? this.file(
											pinned,
											entry.search,
											(raw) => parseDiscoveryDataV2(raw, pinned.index, category, entry, "search"),
											signal,
										)
									: Promise.resolve(null),
							),
						);
						signal.throwIfAborted();
						for (const [i, part] of parts.entries()) {
							const entry = entries[i];
							if (part.status === "rejected") {
								progress.failures.push({ path: entry.search.path, code: discoveryErrorCode(part.reason) });
								continue;
							}
							if (part.value) {
								if (part.value.some((row) => slugs.has(row.slug) || row.slug <= lastSlug)) {
									progress.failures.push({ path: entry.search.path, code: "content-invalid" });
									continue;
								}
								for (const ability of part.value) {
									slugs.add(ability.slug);
									lastSlug = ability.slug;
									if (excludedSlugs.has(ability.slug) || !discoveryRecordMatches(ability, query)) continue;
									if (progress.matched >= query.offset && rows.length < query.limit)
										rows.push({
											ability,
											reference: { revision: pinned.revision, category, searchPath: entry.search.path },
										});
									progress.matched++;
								}
							}
							progress.scanned += entry.count;
						}
						update(snapshot());
						await yieldTask(undefined, { signal });
					}
					path = page.next?.path ?? path;
				}
			} catch (error) {
				signal.throwIfAborted();
				progress.failures.push({ path, code: discoveryErrorCode(error) });
			}
		}
		if (categories.length === Object.keys(pinned.index.categories).length && !progress.failures.length) {
			const totals = pinned.index.totalBytes;
			if (searchBytes !== totals.search || detailBytes !== totals.detail || pageBytes !== totals.pages)
				progress.failures.push({ path: "v2/index.json", code: "content-invalid" });
		}
		signal.throwIfAborted();
		progress.running = false;
		progress.complete = progress.failures.length === 0;
		const result = snapshot();
		update(result);
		return result;
	}
	async detail(slug: string, version: string, reference: McpDiscoveryReference): Promise<DiscoveryAbilityV2> {
		// Different records share one validated shard, including simultaneous detail opens.
		const key = `${reference.revision}:${reference.category}:${reference.searchPath}:${version}`;
		let request = this.detailRequests.get(key);
		if (!request) {
			if (this.detailRequests.size >= 8) throw new Error("Too many discovery detail requests");
			request = this.loadDetailShard(version, reference).finally(() => this.detailRequests.delete(key));
			this.detailRequests.set(key, request);
		}
		const full = (await request).find((row) => row.slug === slug);
		if (!full) throw new Error("Unknown discovery detail");
		return full;
	}
	private async loadDetailShard(version: string, reference: McpDiscoveryReference): Promise<DiscoveryAbilityV2[]> {
		const current = await this.cached();
		const pinned = current?.revision === reference.revision ? current : await this.readRoot("previous.json");
		if (!pinned || pinned.revision !== reference.revision || pinned.index.catalogVersion !== version)
			throw new Error("Discovery catalog changed; refresh the catalog");
		const signal = new AbortController().signal;
		let found: DiscoveryEntryV2 | undefined;
		for await (const { page } of this.pages(pinned, reference.category, signal)) {
			found = page.entries.find((entry) => entry.search.path === reference.searchPath);
			if (found) break;
		}
		if (!found) throw new Error("Invalid discovery detail locator");
		const entry = found;
		const summary = await this.file(
			pinned,
			entry.search,
			(raw) => parseDiscoveryDataV2(raw, pinned.index, reference.category, entry, "search"),
			signal,
		);
		return this.file(
			pinned,
			entry.detail,
			(raw) => {
				const details = parseDiscoveryDataV2(raw, pinned.index, reference.category, entry, "detail");
				if (
					details.some(
						(row, i) =>
							row.slug !== summary[i].slug ||
							row.version !== summary[i].version ||
							row.configVersion !== summary[i].configVersion,
					)
				)
					throw new Error("Discovery detail identity mismatch");
				return details;
			},
			signal,
		);
	}
}
