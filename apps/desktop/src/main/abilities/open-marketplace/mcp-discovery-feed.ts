import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OpenMarketplaceDiscoveryStatus } from "../../../preload/api-types/abilities.js";
import {
	type McpDiscoveryAbility,
	type McpDiscoveryIndex,
	parseMcpDiscoveryIndex,
	parseMcpDiscoveryShardEntries,
	verifyMcpDiscoveryShard,
} from "./mcp-discovery-catalog.js";

type DiscoveryErrorCode = NonNullable<OpenMarketplaceDiscoveryStatus["error"]>;
class DiscoveryError extends Error {
	constructor(
		readonly code: DiscoveryErrorCode,
		message: string,
	) {
		super(message);
	}
}
export interface McpDiscoverySnapshot {
	abilities: McpDiscoveryAbility[];
	status: OpenMarketplaceDiscoveryStatus;
}
interface FeedOptions {
	rootDir: string;
	repository: string;
	fetch: (url: string, init?: RequestInit) => Promise<Response>;
	timeoutMs?: number;
	retryDelayMs?: number;
}
interface PinnedIndex {
	revision: string;
	index: McpDiscoveryIndex;
}

/** Discovery is a browse-only feed. Cache identities are content hashes, never upstream file paths. */
export class McpDiscoveryFeed {
	private memory: McpDiscoverySnapshot | null = null;
	private pinned: PinnedIndex | null = null;
	private readonly detailRequests = new Map<string, Promise<ReturnType<McpDiscoveryFeed["parseShard"]>>>();
	private inFlight: Promise<McpDiscoverySnapshot> | undefined;
	private readonly root: string;
	private readonly coordinates: string;
	constructor(private readonly options: FeedOptions) {
		this.root = join(options.rootDir, "discovery-feed");
		const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/?$/.exec(options.repository);
		if (!match) throw new Error("Invalid discovery repository");
		this.coordinates = match[1];
	}
	private cachePath(sha256: string): string {
		return join(this.root, "shards", `${sha256}.json`);
	}
	private async atomicWrite(path: string, bytes: string | Uint8Array): Promise<void> {
		const temporary = `${path}.tmp-${process.pid}`;
		try {
			await writeFile(temporary, bytes);
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}
	private async download(url: string, limit: number): Promise<Buffer> {
		for (let attempt = 0; ; attempt++) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
			try {
				const response = await this.options.fetch(url, {
					headers: { Accept: "application/json", "User-Agent": "567-Agent-Desktop" },
					signal: controller.signal,
					redirect: "follow",
				});
				if (!response.ok)
					throw new DiscoveryError(
						response.status === 429
							? "rate-limited"
							: response.status === 404
								? "not-found"
								: response.status === 401 || response.status === 403
									? "forbidden"
									: "network",
						`Discovery HTTP ${response.status}`,
					);
				if (Number(response.headers.get("content-length")) > limit)
					throw new DiscoveryError("content-invalid", "Discovery response exceeds size limit");
				const reader = response.body?.getReader();
				if (!reader) return Buffer.alloc(0);
				const chunks: Uint8Array[] = [];
				let size = 0;
				try {
					for (;;) {
						const chunk = await reader.read();
						if (chunk.done) break;
						size += chunk.value.byteLength;
						if (size > limit) {
							await reader.cancel();
							throw new DiscoveryError("content-invalid", "Discovery response exceeds size limit");
						}
						chunks.push(chunk.value);
					}
				} finally {
					reader.releaseLock();
				}
				return Buffer.concat(chunks, size);
			} catch (cause) {
				const error = controller.signal.aborted
					? new DiscoveryError("timeout", "Discovery request timed out")
					: cause instanceof DiscoveryError
						? cause
						: new DiscoveryError("network", "Discovery connection failed");
				if (attempt >= 1 || !["network", "timeout", "rate-limited"].includes(error.code)) throw error;
			} finally {
				clearTimeout(timer);
			}
			await new Promise((resolve) => setTimeout(resolve, this.options.retryDelayMs ?? 500));
		}
	}
	private async pinIndex(): Promise<PinnedIndex> {
		const ref: unknown = JSON.parse(
			(
				await this.download(`https://api.github.com/repos/${this.coordinates}/git/ref/heads/catalog`, 64 * 1024)
			).toString("utf8"),
		);
		const object = ref && typeof ref === "object" && "object" in ref ? ref.object : null;
		const revision = object && typeof object === "object" && "sha" in object ? object.sha : null;
		if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision))
			throw new DiscoveryError("content-invalid", "Invalid catalog revision");
		const index = parseMcpDiscoveryIndex(
			JSON.parse(
				(
					await this.download(
						`https://raw.githubusercontent.com/${this.coordinates}/${revision}/index.json`,
						2 * 1024 * 1024,
					)
				).toString("utf8"),
			),
		);
		if (index.shards.reduce((sum, shard) => sum + shard.sizeBytes, 0) > 100 * 1024 * 1024)
			throw new DiscoveryError("content-invalid", "Discovery catalog exceeds total size limit");
		return { revision, index };
	}
	private parseShard(bytes: Buffer, index: McpDiscoveryIndex, shard: McpDiscoveryIndex["shards"][number]) {
		try {
			verifyMcpDiscoveryShard(bytes, shard);
			const parsed = parseMcpDiscoveryShardEntries(
				JSON.parse(bytes.toString("utf8")),
				index.catalogVersion,
				shard.count,
			);
			const summaries = shard.path.startsWith("search/");
			const validated = parsed.abilities.filter((ability) =>
				summaries
					? index.shards.some(
							(detail) => detail.path === ability.detailShard && detail.category === ability.category,
						)
					: !ability.detailShard,
			);
			return {
				abilities: validated,
				invalidRecords: parsed.invalidRecords + parsed.abilities.length - validated.length,
			};
		} catch {
			throw new DiscoveryError("content-invalid", "Discovery shard validation failed");
		}
	}
	private async cachedShard(index: McpDiscoveryIndex, shard: McpDiscoveryIndex["shards"][number]) {
		try {
			return this.parseShard(await readFile(this.cachePath(shard.sha256)), index, shard);
		} catch {
			return null;
		}
	}
	private assemble(
		index: McpDiscoveryIndex,
		parts: Array<Awaited<ReturnType<McpDiscoveryFeed["cachedShard"]>>>,
		syncing: boolean,
		error?: DiscoveryErrorCode,
	): McpDiscoverySnapshot {
		const slugs = new Set<string>();
		const abilities: McpDiscoveryAbility[] = [];
		let invalidRecords = 0;
		for (const part of parts) {
			if (!part) continue;
			invalidRecords += part.invalidRecords;
			for (const ability of part.abilities) {
				if (slugs.has(ability.slug)) {
					invalidRecords++;
					continue;
				}
				slugs.add(ability.slug);
				abilities.push(ability);
			}
		}
		return {
			abilities,
			status: {
				version: index.catalogVersion,
				total: index.recordCount,
				loaded: abilities.length,
				failedShards: parts.filter((part) => !part).length,
				invalidRecords,
				syncing,
				...(error ? { error } : {}),
			},
		};
	}
	private async readIndex(path: string): Promise<McpDiscoveryIndex | null> {
		try {
			const raw: unknown = JSON.parse(await readFile(path, "utf8"));
			if (!raw || typeof raw !== "object" || !("index" in raw)) return null;
			return parseMcpDiscoveryIndex(raw.index);
		} catch {
			return null;
		}
	}
	private async pruneCache(index: McpDiscoveryIndex, previous: McpDiscoveryIndex | null): Promise<void> {
		// Keep at most two catalog generations, including while the current one is incomplete.
		const retained = new Set(
			[index, ...(previous ? [previous] : [])].flatMap((catalog) =>
				[...catalog.shards, ...(catalog.searchShards ?? [])].map((shard) => `${shard.sha256}.json`),
			),
		);
		const entries = await readdir(join(this.root, "shards"));
		await Promise.all(
			entries
				.filter((name) => /^[a-f0-9]{64}\.json$/.test(name) && !retained.has(name))
				.map((name) => rm(join(this.root, "shards", name), { force: true })),
		);
	}
	async cached(): Promise<McpDiscoverySnapshot | null> {
		if (this.memory) return this.memory;
		try {
			const pinned: unknown = JSON.parse(await readFile(join(this.root, "active.json"), "utf8"));
			if (!pinned || typeof pinned !== "object" || !("index" in pinned)) return null;
			const index = parseMcpDiscoveryIndex(pinned.index);
			if ("revision" in pinned && typeof pinned.revision === "string" && /^[a-f0-9]{40}$/.test(pinned.revision))
				this.pinned = { revision: pinned.revision, index };
			const parts = await Promise.all(
				(index.searchShards ?? index.shards).map((shard) => this.cachedShard(index, shard)),
			);
			this.memory = this.assemble(index, parts, false, parts.some((part) => !part) ? "network" : undefined);
			return this.memory;
		} catch {
			return null;
		}
	}
	async detail(slug: string, catalogVersion: string): Promise<McpDiscoveryAbility> {
		await this.cached();
		const pinned = this.pinned;
		const row = this.memory?.abilities.find((entry) => entry.slug === slug);
		if (!pinned || pinned.index.catalogVersion !== catalogVersion || !row)
			throw new Error("Discovery catalog changed; refresh the catalog");
		if (!row.detailShard) return row;
		const descriptor = pinned.index.shards.find((shard) => shard.path === row.detailShard);
		if (!descriptor) throw new Error("Invalid discovery detail locator");
		let part = await this.cachedShard(pinned.index, descriptor);
		if (!part) {
			let request = this.detailRequests.get(descriptor.sha256);
			if (!request) {
				request = (async () => {
					const bytes = await this.download(
						`https://raw.githubusercontent.com/${this.coordinates}/${pinned.revision}/${descriptor.path}`,
						descriptor.sizeBytes,
					);
					const parsed = this.parseShard(bytes, pinned.index, descriptor);
					await this.atomicWrite(this.cachePath(descriptor.sha256), bytes);
					return parsed;
				})().finally(() => this.detailRequests.delete(descriptor.sha256));
				this.detailRequests.set(descriptor.sha256, request);
			}
			part = await request;
		}
		const full = part.abilities.find((entry) => entry.slug === slug);
		if (!full || full.category !== row.category || full.version !== row.version)
			throw new Error("Discovery detail identity mismatch");
		return full;
	}

	sync(marketplaceVersion: string, onUpdate: (snapshot: McpDiscoverySnapshot) => void): Promise<McpDiscoverySnapshot> {
		this.inFlight ??= this.synchronize(marketplaceVersion, onUpdate).finally(() => {
			this.inFlight = undefined;
		});
		return this.inFlight;
	}
	private async synchronize(
		marketplaceVersion: string,
		onUpdate: (snapshot: McpDiscoverySnapshot) => void,
	): Promise<McpDiscoverySnapshot> {
		const previous = await this.cached();
		try {
			const pinned = await this.pinIndex();
			const { index, revision } = pinned;
			if (index.marketplaceVersion !== marketplaceVersion)
				throw new DiscoveryError("content-invalid", "Install and discovery catalog versions differ");
			await mkdir(join(this.root, "shards"), { recursive: true });
			const activeIndex = await this.readIndex(join(this.root, "active.json"));
			const previousIndex =
				activeIndex && activeIndex.catalogVersion !== index.catalogVersion
					? activeIndex
					: await this.readIndex(join(this.root, "previous.json"));
			if (previousIndex)
				await this.atomicWrite(join(this.root, "previous.json"), JSON.stringify({ index: previousIndex }));
			const parts = await Promise.all(
				(index.searchShards ?? index.shards).map((shard) => this.cachedShard(index, shard)),
			);
			let lastPublish = 0;
			let lastLoaded = -1;
			let failure: DiscoveryErrorCode | undefined;
			const publish = async (syncing: boolean) => {
				const snapshot = this.assemble(index, parts, syncing, failure);
				if (snapshot.abilities.length || index.recordCount === 0) {
					await this.atomicWrite(join(this.root, "active.json"), JSON.stringify(pinned));
					this.memory = snapshot;
					this.pinned = pinned;
				} else
					this.memory = {
						abilities: previous?.abilities ?? [],
						status: previous
							? { ...previous.status, syncing, ...(failure ? { error: failure } : {}) }
							: snapshot.status,
					};
				onUpdate(this.memory);
				lastLoaded = snapshot.status.loaded;
				lastPublish = Date.now();
				return this.memory;
			};
			await publish(true);
			const downloadShards = index.searchShards ?? index.shards;
			const missing = downloadShards.map((_, i) => i).filter((i) => !parts[i]);
			for (let offset = 0; offset < missing.length; offset += 4) {
				await Promise.all(
					missing.slice(offset, offset + 4).map(async (i) => {
						const shard = downloadShards[i];
						try {
							const bytes = await this.download(
								`https://raw.githubusercontent.com/${this.coordinates}/${revision}/${shard.path}`,
								shard.sizeBytes,
							);
							parts[i] = this.parseShard(bytes, index, shard);
							await this.atomicWrite(this.cachePath(shard.sha256), bytes);
						} catch (error) {
							parts[i] = null;
							failure = error instanceof DiscoveryError ? error.code : "content-invalid";
						}
					}),
				);
				const loaded = parts.reduce((sum, part) => sum + (part?.abilities.length ?? 0), 0);
				if (
					loaded > lastLoaded &&
					(lastLoaded === 0 || Date.now() - lastPublish >= 3000 || loaded - lastLoaded >= 4000)
				)
					await publish(true);
			}
			await this.pruneCache(index, previousIndex).catch(() => undefined);
			return publish(false);
		} catch (error) {
			const code = error instanceof DiscoveryError ? error.code : "content-invalid";
			this.memory = {
				abilities: previous?.abilities ?? [],
				status: {
					version: previous?.status.version ?? null,
					total: previous?.status.total ?? 0,
					loaded: previous?.abilities.length ?? 0,
					failedShards: previous?.status.failedShards ?? 0,
					invalidRecords: previous?.status.invalidRecords ?? 0,
					syncing: false,
					error: code,
				},
			};
			onUpdate(this.memory);
			return this.memory;
		}
	}
}
