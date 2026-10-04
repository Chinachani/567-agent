import { describe, expect, it } from "vitest";
import fixture from "./fixtures/marketplace-contract.json";
import { parseMarketplaceManifest } from "./marketplace-schema.js";
import {
	parseMcpDiscoveryIndex,
	parseMcpDiscoveryShard,
	parseMcpDiscoveryShardEntries,
	verifyMcpDiscoveryShard,
} from "./mcp-discovery-catalog.js";

describe("marketplace producer/desktop contract fixture", () => {
	it("accepts generated MCP rows without inline config and discovery rows without icon", () => {
		expect(parseMarketplaceManifest(fixture.manifest).abilities[0]).toMatchObject({ slug: "reference", config: {} });
		expect(parseMcpDiscoveryShard(fixture.discovery, fixture.discovery.catalogVersion)[0]).toMatchObject({
			icon: "",
			mcpMetadata: { installable: false },
		});
	});
	it("accepts publisher-generated summary indexes with verified detail locators", () => {
		const index = parseMcpDiscoveryIndex(fixture.index);
		verifyMcpDiscoveryShard(Buffer.from(JSON.stringify(fixture.search)), index.searchShards![0]);
		const parsed = parseMcpDiscoveryShardEntries(fixture.search, index.catalogVersion, index.recordCount);
		expect(parsed.invalidRecords).toBe(0);
		expect(parsed.abilities[0].detailShard).toBe(index.shards[0].path);
		expect(parsed.abilities[0].mcpMetadata.installable).toBe(false);
	});

	it("rejects unsafe generated versions without making inline commands installable", () => {
		const manifest = structuredClone(fixture.manifest);
		manifest.abilities[0].version = "1.0.0+0.7.1";
		expect(() => parseMarketplaceManifest(manifest)).toThrow();
		expect(() =>
			parseMarketplaceManifest({
				...fixture.manifest,
				abilities: [{ ...fixture.manifest.abilities[0], config: { mcp: { command: "evil" } } }],
			}),
		).toThrow();
	});
});
