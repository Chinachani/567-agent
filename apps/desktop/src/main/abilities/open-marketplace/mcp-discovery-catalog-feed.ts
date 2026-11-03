import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpDiscoveryReference } from "../../../shared/mcp-discovery.js";
import { writeDiscoveryCache } from "./mcp-discovery-cache.js";
import { McpDiscoveryFeed, type McpDiscoverySnapshot } from "./mcp-discovery-feed.js";
import { DiscoveryError, type DiscoveryTransportOptions, discoveryErrorCode } from "./mcp-discovery-transport.js";
import { McpDiscoveryV2Feed, type PinnedDiscoveryV2 } from "./mcp-discovery-v2-feed.js";

interface Options extends DiscoveryTransportOptions {
	rootDir: string;
	repository: string;
}
function v2Snapshot(root: PinnedDiscoveryV2): McpDiscoverySnapshot {
	return {
		abilities: [],
		status: {
			protocol: 2,
			revision: root.revision,
			version: root.index.catalogVersion,
			total: root.index.recordCount,
			loaded: 0,
			failedShards: 0,
			invalidRecords: 0,
			syncing: false,
			categories: root.index.categories,
			legacy: root.index.legacy,
		},
	};
}
/** Protocol negotiation owns the fallback policy; v1 retains its existing validated cache untouched. */
export class McpDiscoveryCatalogFeed {
	readonly v2: McpDiscoveryV2Feed;
	private readonly v1: McpDiscoveryFeed;
	private restore: Promise<McpDiscoverySnapshot | null> | undefined;
	private readonly preferencePath: string;
	private memory: McpDiscoverySnapshot | null = null;
	private inFlight: Promise<McpDiscoverySnapshot> | undefined;
	constructor(options: Options) {
		this.preferencePath = join(options.rootDir, "discovery-protocol.json");
		this.v1 = new McpDiscoveryFeed(options);
		this.v2 = new McpDiscoveryV2Feed(options);
	}
	async cached(): Promise<McpDiscoverySnapshot | null> {
		if (this.memory) return this.memory;
		this.restore ??= (async () => {
			const preferred = await readFile(this.preferencePath, "utf8").catch(() => "");
			const root = await this.v2.cached();
			const legacy = preferred === "1" || !root ? await this.v1.cached() : null;
			this.memory = legacy ?? (root ? v2Snapshot(root) : null);
			return this.memory;
		})();
		await this.restore;
		return this.memory;
	}
	sync(marketplaceVersion: string, update: (snapshot: McpDiscoverySnapshot) => void): Promise<McpDiscoverySnapshot> {
		this.inFlight ??= this.synchronize(marketplaceVersion, update).finally(() => {
			this.inFlight = undefined;
		});
		return this.inFlight;
	}
	private async synchronize(
		marketplaceVersion: string,
		update: (snapshot: McpDiscoverySnapshot) => void,
	): Promise<McpDiscoverySnapshot> {
		const previous = await this.cached();
		try {
			const revision = await this.v2.pinRevision();
			try {
				this.memory = v2Snapshot(await this.v2.sync(revision));
			} catch (error) {
				if (!(error instanceof DiscoveryError) || error.code !== "not-found") throw error;
				// Only an absent v2 index allows a v1 fallback, at exactly the same pinned revision.
				const legacy = await this.v1.sync(marketplaceVersion, update, revision);
				this.memory =
					legacy.status.error && previous
						? { ...previous, status: { ...previous.status, error: legacy.status.error, syncing: false } }
						: legacy;
			}
		} catch (error) {
			this.memory = {
				abilities: previous?.abilities ?? [],
				status: {
					version: null,
					total: 0,
					loaded: 0,
					failedShards: 0,
					invalidRecords: 0,
					...previous?.status,
					syncing: false,
					error: discoveryErrorCode(error),
				},
			};
		}
		if (!this.memory.status.error) {
			await mkdir(join(this.preferencePath, ".."), { recursive: true });
			await writeDiscoveryCache(this.preferencePath, this.memory.status.protocol === 2 ? "2" : "1").catch(
				() => undefined,
			);
		}
		update(this.memory);
		return this.memory;
	}
	async detail(slug: string, version: string, reference?: McpDiscoveryReference) {
		return reference ? this.v2.detail(slug, version, reference) : this.v1.detail(slug, version);
	}
}
