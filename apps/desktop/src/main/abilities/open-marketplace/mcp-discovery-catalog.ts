import { createHash } from "node:crypto";
import { z } from "zod";
import { marketplaceDetailSchema } from "./marketplace-schema.js";

const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const categorySchema = z.enum([
	"ai-agents",
	"automation",
	"cad-3d",
	"communication",
	"creative-media",
	"data-databases",
	"developer-tools",
	"knowledge-memory",
	"productivity",
	"system-tools",
	"web-search",
	"uncategorized",
]);
const discoveryAbilitySchema = z
	.object({
		type: z.literal("mcp"),
		detailShard: z
			.string()
			.regex(/^shards\/mcp-[a-z0-9-]+-[0-9]{4,6}\.json$/)
			.optional(),
		slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
		name: z.string().min(1).max(512),
		description: z.string().max(20_000),
		version: z.string().max(64),
		configVersion: z.number().int().positive(),
		license: z.string().max(256),
		author: z.string().max(512),
		icon: z.string().max(2_048).default(""),
		category: z.string().max(128),
		categoryI18n: z.record(z.string(), z.string()).optional(),
		tags: z.array(z.string().max(128)).max(16),
		detail: marketplaceDetailSchema,
		classificationSource: z.enum(["automatic", "maintainer"]).optional(),
		mcpMetadata: z.object({ installable: z.literal(false) }).passthrough(),
	})
	.passthrough();
const discoveryShardSchema = z.object({
	schemaVersion: z.literal(1),
	catalogVersion: z.string().regex(VERSION_PATTERN),
	category: categorySchema,
	abilities: z.array(discoveryAbilitySchema).max(500),
});

const shardDescriptorSchema = z.object({
	path: z.string().regex(/^(?:shards|search)\/mcp-[a-z0-9-]+-[0-9]{4,6}\.json$/),
	category: categorySchema,
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	sizeBytes: z
		.number()
		.int()
		.positive()
		.max(1024 * 1024),
	count: z.number().int().positive().max(500),
});
const discoveryIndexSchema = z.object({
	schemaVersion: z.literal(1),
	catalogVersion: z.string().regex(VERSION_PATTERN),
	marketplaceVersion: z.string().regex(VERSION_PATTERN),
	recordCount: z.number().int().nonnegative().max(100_000),
	categories: z.record(z.string(), z.number().int().nonnegative()),
	shards: z.array(shardDescriptorSchema).max(250),
	searchShards: z.array(shardDescriptorSchema).max(250).optional(),
});

export type McpDiscoveryIndex = z.infer<typeof discoveryIndexSchema>;
export type McpDiscoveryAbility = z.infer<typeof discoveryAbilitySchema>;

export function parseMcpDiscoveryIndex(input: unknown): McpDiscoveryIndex {
	const index = discoveryIndexSchema.parse(input);
	for (const [prefix, descriptors] of [
		["shards", index.shards],
		["search", index.searchShards],
	] as const) {
		if (!descriptors) continue;
		const paths = new Set<string>();
		const hashes = new Set<string>();
		const counts = new Map<string, number>();
		let total = 0;
		let bytes = 0;
		for (const shard of descriptors) {
			if (!shard.path.startsWith(`${prefix}/mcp-${shard.category}-`))
				throw new Error("MCP discovery path category mismatch");
			if (paths.has(shard.path) || hashes.has(shard.sha256)) throw new Error("Duplicate MCP discovery shard");
			paths.add(shard.path);
			hashes.add(shard.sha256);
			total += shard.count;
			bytes += shard.sizeBytes;
			counts.set(shard.category, (counts.get(shard.category) ?? 0) + shard.count);
		}
		if (total !== index.recordCount || bytes > 100 * 1024 * 1024)
			throw new Error("MCP discovery capacity/count mismatch");
		let categoryTotal = 0;
		for (const [category, count] of Object.entries(index.categories)) {
			categorySchema.parse(category);
			if (counts.get(category) !== count) throw new Error("MCP discovery category count mismatch");
			categoryTotal += count;
		}
		if (categoryTotal !== index.recordCount) throw new Error("MCP discovery category count mismatch");
	}
	return index;
}

export function parseMcpDiscoveryShard(input: unknown, expectedVersion: string): McpDiscoveryAbility[] {
	const shard = discoveryShardSchema.parse(input);
	if (shard.catalogVersion !== expectedVersion) throw new Error("MCP discovery shard version mismatch");
	if (shard.abilities.some((ability) => ability.category !== shard.category)) {
		throw new Error("MCP discovery shard category mismatch");
	}
	if (shard.abilities.some((ability) => ability.mcpMetadata.installable !== false)) {
		throw new Error("Unreviewed MCP discovery entries cannot be installable");
	}
	return shard.abilities;
}

export function verifyMcpDiscoveryShard(bytes: Uint8Array, expected: { sha256: string; sizeBytes: number }): void {
	if (bytes.byteLength !== expected.sizeBytes) throw new Error("MCP discovery shard size mismatch");
	const actual = createHash("sha256").update(bytes).digest("hex");
	if (actual !== expected.sha256) throw new Error("MCP discovery shard checksum mismatch");
}

/** A malformed entry is isolated; envelope, digest and source counts remain mandatory. */
export function parseMcpDiscoveryShardEntries(
	input: unknown,
	expectedVersion: string,
	expectedCount: number,
): {
	abilities: McpDiscoveryAbility[];
	invalidRecords: number;
} {
	const envelope = discoveryShardSchema
		.omit({ abilities: true })
		.extend({ abilities: z.array(z.unknown()).max(500) })
		.parse(input);
	if (envelope.catalogVersion !== expectedVersion || envelope.abilities.length !== expectedCount)
		throw new Error("MCP discovery shard envelope mismatch");
	const abilities: McpDiscoveryAbility[] = [];
	let invalidRecords = 0;
	for (const inputEntry of envelope.abilities) {
		const parsed = discoveryAbilitySchema.safeParse(inputEntry);
		if (!parsed.success || parsed.data.category !== envelope.category) {
			invalidRecords++;
			continue;
		}
		abilities.push(parsed.data);
	}
	return { abilities, invalidRecords };
}
