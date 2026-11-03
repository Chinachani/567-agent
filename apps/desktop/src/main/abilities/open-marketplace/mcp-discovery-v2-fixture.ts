import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyDiscoveryFacets } from "../../../shared/mcp-discovery.js";
import {
	addFacets,
	type DiscoveryAbilityV2,
	type DiscoveryEntryV2,
	type DiscoveryFileRef,
	type DiscoveryIndexV2,
	parseDiscoveryIndexV2,
	recordFacets,
} from "./mcp-discovery-v2-schema.js";

export const TEST_REVISION = "a".repeat(40);
export const TEST_REPOSITORY = "https://github.com/example/catalog";
export function descriptor(path: string, bytes: Buffer): DiscoveryFileRef {
	return { path, sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length };
}
export async function officialFiles(): Promise<Map<string, () => Buffer>> {
	const files = new Map<string, () => Buffer>();
	const root = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "mcp-catalog-v2");
	for (const file of await readdir(join(root, "v2"), { recursive: true, withFileTypes: true })) {
		if (!file.isFile()) continue;
		const path = join(file.parentPath, file.name);
		const bytes = await readFile(path);
		files.set(relative(root, path).replaceAll("\\", "/"), () => bytes);
	}
	return files;
}
export function generatedCatalog(shards = 65, perShard = 1, descriptionLength = 0) {
	const files = new Map<string, () => Buffer>();
	const entries: DiscoveryEntryV2[] = [];
	const facets = emptyDiscoveryFacets();
	let searchBytes = 0;
	let detailBytes = 0;
	for (let shard = 0; shard < shards; shard++) {
		const suffix = String(shard).padStart(6, "0");
		const searchPath = `v2/search/mcp-cad-3d-${suffix}.json`;
		const detailPath = `v2/shards/mcp-cad-3d-${suffix}.json`;
		const rows = (detail: boolean): DiscoveryAbilityV2[] =>
			Array.from({ length: perShard }, (_, i) => {
				const slug = `item-${String(shard * perShard + i).padStart(8, "0")}`;
				return {
					type: "mcp",
					slug,
					name: slug,
					description: detail ? "x".repeat(descriptionLength) : "summary",
					version: "1",
					configVersion: 1,
					author: "",
					license: "",
					icon: "",
					category: "cad-3d",
					tags: [shard === shards - 1 ? "last" : "cad"],
					detail: { i18n: { zh: {} } },
					mcpMetadata: {
						installable: false,
						runtimeMode: "stdio",
						platforms: ["linux"],
						permissionScopes: ["unknown"],
						authentication: "unknown",
						publisherType: "unknown",
					},
					...(detail ? {} : { detailShard: detailPath }),
				};
			});
		const body = (detail: boolean) =>
			Buffer.from(
				JSON.stringify({
					schemaVersion: 2,
					catalogVersion: "test-v2",
					category: "cad-3d",
					abilities: rows(detail),
				}),
			);
		files.set(searchPath, () => body(false));
		files.set(detailPath, () => body(true));
		const entry = {
			count: perShard,
			facets: recordFacets(rows(false)),
			search: descriptor(searchPath, body(false)),
			detail: descriptor(detailPath, body(true)),
		};
		entries.push(entry);
		addFacets(facets, entry.facets);
		searchBytes += entry.search.sizeBytes;
		detailBytes += entry.detail.sizeBytes;
	}
	const index: DiscoveryIndexV2 = {
		schemaVersion: 2,
		catalogVersion: "test-v2",
		marketplaceVersion: "1",
		recordCount: shards * perShard,
		categories: {},
		totalBytes: { search: searchBytes, detail: detailBytes, pages: 0 },
		limits: { dataItems: 500, dataBytes: 1048576, pageEntries: 64, indexBytes: 262144 },
		legacy: { status: "unavailable", reason: "test" },
	};
	let next: DiscoveryFileRef | null = null;
	for (let page = Math.ceil(entries.length / 64) - 1; page >= 0; page--) {
		const path = `v2/pages/cad-3d/${String(page).padStart(6, "0")}.json`;
		const bytes = Buffer.from(
			JSON.stringify({
				schemaVersion: 2,
				catalogVersion: "test-v2",
				category: "cad-3d",
				entries: entries.slice(page * 64, (page + 1) * 64),
				next,
			}),
		);
		files.set(path, () => bytes);
		next = descriptor(path, bytes);
		index.totalBytes.pages += bytes.length;
	}
	if (next)
		index.categories["cad-3d"] = {
			recordCount: index.recordCount,
			pageCount: Math.ceil(shards / 64),
			shardCount: shards,
			firstPage: next,
			facets,
		};
	files.set("v2/index.json", () => Buffer.from(JSON.stringify(index)));
	return { files, index: parseDiscoveryIndexV2(index), entries };
}
