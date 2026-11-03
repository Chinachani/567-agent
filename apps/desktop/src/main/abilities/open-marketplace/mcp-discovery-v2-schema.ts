import { z } from "zod";
import {
	emptyDiscoveryFacets,
	MCP_DISCOVERY_CATEGORIES,
	MCP_DISCOVERY_FACETS,
	type McpDiscoveryFacets,
} from "../../../shared/mcp-discovery.js";
import { discoveryAbilitySchema } from "./mcp-discovery-catalog.js";

export const V2_INDEX_BYTES = 256 * 1024;
export const V2_DATA_BYTES = 1024 * 1024;
const count = z.number().int().nonnegative().safe();
const positive = count.positive();
const value = z.string().trim().min(1).max(128);
const category = z.enum(MCP_DISCOVERY_CATEGORIES);
const version = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
export const fileRefSchema = z.object({
	path: z.string().max(160),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	sizeBytes: positive.max(V2_DATA_BYTES),
});
// Metadata is extensible. Preserve even prototype-like names as ordinary own keys.
const facetCounts = z.unknown().transform((input, context): Record<string, number> => {
	const result: Record<string, number> = Object.create(null);
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		context.addIssue({ code: "custom", message: "Invalid discovery facets" });
		return z.NEVER;
	}
	for (const [key, count] of Object.entries(input)) {
		const parsedKey = value.safeParse(key);
		const parsedCount = positive.safeParse(count);
		if (!parsedKey.success || parsedKey.data !== key || !parsedCount.success) {
			context.addIssue({ code: "custom", message: "Invalid discovery facet", path: [key] });
			return z.NEVER;
		}
		result[key] = parsedCount.data;
	}
	return result;
});
const facets = z.object(
	Object.fromEntries(MCP_DISCOVERY_FACETS.map((key) => [key, facetCounts])) as Record<
		(typeof MCP_DISCOVERY_FACETS)[number],
		typeof facetCounts
	>,
);
const categoryInfo = z.object({
	recordCount: positive,
	pageCount: positive,
	shardCount: positive,
	firstPage: fileRefSchema,
	facets,
});
const indexSchema = z.object({
	schemaVersion: z.literal(2),
	catalogVersion: version,
	marketplaceVersion: version,
	recordCount: count,
	categories: z.partialRecord(category, categoryInfo),
	totalBytes: z.object({ search: count, detail: count, pages: count }),
	limits: z.object({
		dataItems: z.literal(500),
		dataBytes: z.literal(V2_DATA_BYTES),
		pageEntries: z.literal(64),
		indexBytes: z.literal(V2_INDEX_BYTES),
	}),
	legacy: z.discriminatedUnion("status", [
		z.object({
			status: z.literal("current"),
			path: z.literal("index.json"),
			catalogVersion: version,
			recordCount: count,
		}),
		z.object({
			status: z.literal("frozen"),
			reason: z.literal("capacity-exceeded"),
			path: z.literal("index.json"),
			catalogVersion: version,
			recordCount: count,
		}),
		z.object({ status: z.literal("unavailable"), reason: z.string().min(1).max(256) }),
	]),
});
const entrySchema = z.object({ count: positive.max(500), facets, search: fileRefSchema, detail: fileRefSchema });
const pageSchema = z.object({
	schemaVersion: z.literal(2),
	catalogVersion: version,
	category,
	entries: z.array(entrySchema).min(1).max(64),
	next: fileRefSchema.nullable(),
});
const metadata = z.object({
	installable: z.literal(false),
	runtimeMode: value,
	platforms: z.array(value).min(1).max(32),
	permissionScopes: z.array(value).min(1).max(32),
	authentication: value,
	publisherType: value,
});
const abilitySchema = discoveryAbilitySchema.extend({
	category,
	tags: z.array(value).max(3),
	mcpMetadata: metadata,
	detailShard: z.string().max(160).optional(),
});
const shardSchema = z.object({
	schemaVersion: z.literal(2),
	catalogVersion: version,
	category,
	abilities: z.array(abilitySchema).min(1).max(500),
});
export type DiscoveryIndexV2 = z.infer<typeof indexSchema>;
export type DiscoveryPageV2 = z.infer<typeof pageSchema>;
export type DiscoveryEntryV2 = z.infer<typeof entrySchema>;
export type DiscoveryAbilityV2 = z.infer<typeof abilitySchema>;
export type DiscoveryFileRef = z.infer<typeof fileRefSchema>;
export type DiscoveryCategory = z.infer<typeof category>;

export function assertDiscoveryPath(
	ref: DiscoveryFileRef,
	kind: "pages" | "search" | "shards",
	category: string,
): void {
	const pattern =
		kind === "pages" ? `^v2/pages/${category}/[0-9]{6,}\\.json$` : `^v2/${kind}/mcp-${category}-[0-9]{6,}\\.json$`;
	if (!new RegExp(pattern).test(ref.path) || ref.sizeBytes > (kind === "pages" ? V2_INDEX_BYTES : V2_DATA_BYTES))
		throw new Error("Invalid discovery file path/size");
}
function checkFacets(facets: McpDiscoveryFacets, records: number): void {
	for (const values of Object.values(facets))
		for (const amount of Object.values(values))
			if (amount > records) throw new Error("Invalid discovery facet count");
}
export function parseDiscoveryIndexV2(input: unknown): DiscoveryIndexV2 {
	const index = indexSchema.parse(input);
	let total = 0;
	for (const [category, info] of Object.entries(index.categories)) {
		assertDiscoveryPath(info.firstPage, "pages", category);
		checkFacets(info.facets, info.recordCount);
		if (
			info.pageCount > info.shardCount ||
			info.shardCount > info.recordCount ||
			info.shardCount > info.pageCount * 64 ||
			info.recordCount > info.shardCount * 500
		)
			throw new Error("Invalid discovery category capacity");
		total += info.recordCount;
	}
	if (!Number.isSafeInteger(total) || total !== index.recordCount) throw new Error("Invalid discovery total count");
	return index;
}
export function parseDiscoveryPageV2(
	input: unknown,
	index: DiscoveryIndexV2,
	category: DiscoveryCategory,
): DiscoveryPageV2 {
	const page = pageSchema.parse(input);
	if (page.catalogVersion !== index.catalogVersion || page.category !== category)
		throw new Error("Discovery page identity mismatch");
	if (page.next) assertDiscoveryPath(page.next, "pages", category);
	const paths = new Set<string>();
	for (const entry of page.entries) {
		assertDiscoveryPath(entry.search, "search", category);
		assertDiscoveryPath(entry.detail, "shards", category);
		if (paths.has(entry.search.path) || paths.has(entry.detail.path)) throw new Error("Duplicate discovery shard");
		paths.add(entry.search.path);
		paths.add(entry.detail.path);
		checkFacets(entry.facets, entry.count);
	}
	return page;
}
export function recordFacets(rows: DiscoveryAbilityV2[]): McpDiscoveryFacets {
	const result = emptyDiscoveryFacets();
	for (const row of rows)
		for (const key of MCP_DISCOVERY_FACETS) {
			const values = key === "tags" ? row.tags : row.mcpMetadata[key];
			for (const value of new Set(Array.isArray(values) ? values : [values]))
				result[key][value] = (result[key][value] ?? 0) + 1;
		}
	return result;
}
export function addFacets(target: McpDiscoveryFacets, source: McpDiscoveryFacets): void {
	for (const key of MCP_DISCOVERY_FACETS)
		for (const [value, amount] of Object.entries(source[key]))
			target[key][value] = (target[key][value] ?? 0) + amount;
}
export function assertEqualFacets(a: McpDiscoveryFacets, b: McpDiscoveryFacets): void {
	for (const key of MCP_DISCOVERY_FACETS) {
		if (
			Object.keys(a[key]).length !== Object.keys(b[key]).length ||
			Object.entries(a[key]).some(([value, count]) => !Object.hasOwn(b[key], value) || b[key][value] !== count)
		)
			throw new Error("Discovery facets mismatch");
	}
}
export function parseDiscoveryDataV2(
	input: unknown,
	index: DiscoveryIndexV2,
	category: DiscoveryCategory,
	entry: DiscoveryEntryV2,
	kind: "search" | "detail",
): DiscoveryAbilityV2[] {
	const shard = shardSchema.parse(input);
	if (
		shard.catalogVersion !== index.catalogVersion ||
		shard.category !== category ||
		shard.abilities.length !== entry.count
	)
		throw new Error("Discovery data envelope mismatch");
	let last = "";
	for (const row of shard.abilities) {
		if (
			row.category !== category ||
			row.slug <= last ||
			(kind === "search" ? row.detailShard !== entry.detail.path : row.detailShard !== undefined)
		)
			throw new Error("Discovery record identity mismatch");
		if (
			kind === "search" &&
			(["source", "config", "command", "args", "env"].some((key) => key in row) ||
				[row.description, ...Object.values(row.detail.i18n ?? {}).map((locale) => locale.description ?? "")].some(
					(text) => Array.from(text).length > 320,
				))
		)
			throw new Error("Invalid discovery summary");
		last = row.slug;
	}
	assertEqualFacets(recordFacets(shard.abilities), entry.facets);
	return shard.abilities;
}
