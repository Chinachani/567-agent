import { z } from "zod";

export const MCP_DISCOVERY_CATEGORIES = [
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
] as const;
export const MCP_DISCOVERY_FACETS = [
	"tags",
	"runtimeMode",
	"platforms",
	"permissionScopes",
	"authentication",
	"publisherType",
] as const;
export type McpDiscoveryFacet = (typeof MCP_DISCOVERY_FACETS)[number];
export type McpDiscoveryFacets = Record<McpDiscoveryFacet, Record<string, number>>;
export type McpDiscoveryFilters = Partial<Record<McpDiscoveryFacet, string[]>>;
export interface McpDiscoveryMetadata {
	installable: false;
	runtimeMode: string;
	platforms: string[];
	permissionScopes: string[];
	authentication: string;
	publisherType: string;
}
export const discoveryQuerySchema = z
	.object({
		keyword: z.string().max(512).default(""),
		category: z.enum(MCP_DISCOVERY_CATEGORIES).optional(),
		filters: z
			.object(
				Object.fromEntries(
					MCP_DISCOVERY_FACETS.map((key) => [key, z.array(z.string().trim().min(1).max(128)).max(32).optional()]),
				) as Record<McpDiscoveryFacet, z.ZodOptional<z.ZodArray<z.ZodString>>>,
			)
			.default({}),
		offset: z.number().int().nonnegative().safe().default(0),
		limit: z.number().int().min(1).max(300).default(60),
	})
	.strict();
export type McpDiscoveryQuery = z.infer<typeof discoveryQuerySchema>;
export const discoveryReferenceSchema = z
	.object({
		revision: z.string().regex(/^[a-f0-9]{40}$/),
		category: z.enum(MCP_DISCOVERY_CATEGORIES),
		searchPath: z.string().max(160),
	})
	.strict();
export type McpDiscoveryReference = z.infer<typeof discoveryReferenceSchema>;
export interface McpDiscoveryProgress {
	revision: string;
	version: string;
	matched: number;
	scanned: number;
	total: number;
	complete: boolean;
	running: boolean;
	failures: Array<{ path: string; code: string }>;
}
export function emptyDiscoveryFacets(): McpDiscoveryFacets {
	return Object.fromEntries(MCP_DISCOVERY_FACETS.map((key) => [key, Object.create(null)])) as McpDiscoveryFacets;
}
/** Facets can only exclude impossible matches; intersections must be checked on records. */
export function discoveryFacetsMatch(facets: McpDiscoveryFacets, filters: McpDiscoveryFilters): boolean {
	return MCP_DISCOVERY_FACETS.every((key) =>
		(filters[key] ?? []).every((value) => Object.hasOwn(facets[key], value) && facets[key][value] > 0),
	);
}
export function discoveryRecordMatches(
	row: {
		name: string;
		description: string;
		slug: string;
		tags: string[];
		mcpMetadata: McpDiscoveryMetadata;
		detail: { i18n?: Record<string, { name?: string; description?: string }> };
	},
	query: Pick<McpDiscoveryQuery, "keyword" | "filters">,
): boolean {
	const keyword = query.keyword.trim().toLowerCase();
	if (
		keyword &&
		![
			row.slug,
			row.name,
			row.description,
			...Object.values(row.detail.i18n ?? {}).flatMap((value) => [value.name ?? "", value.description ?? ""]),
		].some((text) => text.toLowerCase().includes(keyword))
	)
		return false;
	return MCP_DISCOVERY_FACETS.every((key) => {
		const values = key === "tags" ? row.tags : row.mcpMetadata[key];
		return (query.filters[key] ?? []).every((value) =>
			Array.isArray(values) ? values.includes(value) : values === value,
		);
	});
}
