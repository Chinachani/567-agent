import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	parseMcpDiscoveryIndex,
	parseMcpDiscoveryShard,
	parseMcpDiscoveryShardEntries,
} from "./mcp-discovery-catalog.js";
import { McpDiscoveryFeed } from "./mcp-discovery-feed.js";

const revision = "a".repeat(40);
const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
function ability(slug: string) {
	// Production catalog records before this fix omit the optional icon entirely.
	return {
		type: "mcp",
		slug,
		name: slug,
		description: "Control Blender",
		version: "1.0.0",
		configVersion: 1,
		license: "",
		author: "",
		category: "cad-3d",
		tags: ["blender"],
		detail: {},
		mcpMetadata: { installable: false },
		classificationSource: "automatic",
	};
}
function distribution(records = [[ability("first")], [ability("second")]]) {
	const bodies = records.map((abilities) =>
		Buffer.from(JSON.stringify({ schemaVersion: 1, catalogVersion: "2026.10.4", category: "cad-3d", abilities })),
	);
	const shards = bodies.map((body, i) => ({
		path: `shards/mcp-cad-3d-${String(i).padStart(4, "0")}.json`,
		category: "cad-3d",
		sha256: createHash("sha256").update(body).digest("hex"),
		sizeBytes: body.length,
		count: records[i].length,
	}));
	const count = records.flat().length;
	return {
		index: {
			schemaVersion: 1,
			catalogVersion: "2026.10.4",
			marketplaceVersion: "1",
			recordCount: count,
			categories: { "cad-3d": count },
			shards,
		},
		bodies,
	};
}
async function fixture(data = distribution()) {
	const rootDir = await mkdtemp(join(tmpdir(), "567-discovery-test-"));
	roots.push(rootDir);
	const failed = new Set<number>();
	const corrupted = new Set<number>();
	const fetcher = vi.fn(async (url: string): Promise<Response> => {
		if (url.includes("/git/ref/")) return Response.json({ object: { sha: revision } });
		expect(url).toContain(`/${revision}/`);
		if (url.endsWith("/index.json")) return Response.json(data.index);
		const index = data.index.shards.findIndex((shard) => url.endsWith(shard.path));
		if (index < 0) return new Response(null, { status: 404 });
		if (failed.has(index)) return new Response(null, { status: 503 });
		return new Response(corrupted.has(index) ? Buffer.alloc(data.bodies[index].length, 0) : data.bodies[index]);
	});
	return {
		rootDir,
		failed,
		corrupted,
		fetcher,
		feed: new McpDiscoveryFeed({
			rootDir,
			repository: "https://github.com/example/catalog",
			fetch: fetcher,
			retryDelayMs: 0,
		}),
	};
}

describe("MCP discovery contract", () => {
	it("accepts deployed records without an icon and keeps discovery non-installable", () => {
		const body = JSON.parse(distribution().bodies[0].toString());
		expect(parseMcpDiscoveryShard(body, "2026.10.4")[0]).toMatchObject({
			icon: "",
			mcpMetadata: { installable: false },
		});
		body.abilities[0].mcpMetadata.installable = true;
		expect(() => parseMcpDiscoveryShard(body, "2026.10.4")).toThrow();
	});
	it("isolates malformed entries without accepting executable configuration", () => {
		const body = {
			schemaVersion: 1,
			catalogVersion: "2026.10.4",
			category: "cad-3d",
			abilities: [
				ability("valid"),
				{ ...ability("unsafe"), mcpMetadata: { installable: true } },
				{ name: "incomplete" },
			],
		};
		expect(parseMcpDiscoveryShardEntries(body, "2026.10.4", 3)).toMatchObject({
			abilities: [{ slug: "valid" }],
			invalidRecords: 2,
		});
		expect(() => parseMcpDiscoveryShardEntries(body, "different", 3)).toThrow();
		expect(() => parseMcpDiscoveryShardEntries(body, "2026.10.4", 2)).toThrow();
	});
	it("rejects indexes with traversal, inconsistent counts or duplicate paths", () => {
		const { index } = distribution();
		expect(() => parseMcpDiscoveryIndex({ ...index, recordCount: 99 })).toThrow();
		expect(() => parseMcpDiscoveryIndex({ ...index, shards: [{ ...index.shards[0], path: "../escape" }] })).toThrow();
		expect(() => parseMcpDiscoveryIndex({ ...index, shards: [index.shards[0], index.shards[0]] })).toThrow();
	});
});

describe("MCP discovery feed", () => {
	it("pins one revision, publishes usable partial results and resumes only failed shards", async () => {
		const { feed, failed, fetcher, rootDir } = await fixture();
		failed.add(1);
		const updates: number[] = [];
		const partial = await feed.sync("1", (snapshot) => updates.push(snapshot.status.loaded));
		expect(partial.status).toMatchObject({ loaded: 1, total: 2, failedShards: 1, syncing: false, error: "network" });
		expect(updates).toContain(1);
		const firstRequests = fetcher.mock.calls.filter(([url]) => url.endsWith("0000.json")).length;
		failed.clear();
		const completed = await feed.sync("1", () => undefined);
		expect(completed.status).toMatchObject({ loaded: 2, failedShards: 0, syncing: false });
		expect(completed.status.error).toBeUndefined();
		expect(fetcher.mock.calls.filter(([url]) => url.endsWith("0000.json"))).toHaveLength(firstRequests);
		const offlineFetch = vi.fn(async (): Promise<Response> => {
			throw new Error("offline");
		});
		const restarted = new McpDiscoveryFeed({
			rootDir,
			repository: "https://github.com/example/catalog",
			fetch: offlineFetch,
			retryDelayMs: 0,
		});
		expect((await restarted.cached())?.abilities).toHaveLength(2);
		const offline = await restarted.sync("1", () => undefined);
		expect(offline.abilities).toHaveLength(2);
		expect(offline.status.error).toBe("network");
	});
	it("rejects checksum mismatches but retains good shards", async () => {
		const { feed, corrupted } = await fixture();
		corrupted.add(0);
		const snapshot = await feed.sync("1", () => undefined);
		expect(snapshot.status).toMatchObject({ loaded: 1, failedShards: 1, error: "content-invalid" });
		expect(snapshot.abilities.map((entry) => entry.slug)).toEqual(["second"]);
	});
	it("repairs corrupted on-disk cache instead of trusting its filename", async () => {
		const data = distribution();
		const { feed, rootDir, fetcher } = await fixture(data);
		await feed.sync("1", () => undefined);
		await writeFile(join(rootDir, "discovery-feed", "shards", `${data.index.shards[0].sha256}.json`), "bad");
		const snapshot = await feed.sync("1", () => undefined);
		expect(snapshot.status.loaded).toBe(2);
		expect(fetcher.mock.calls.filter(([url]) => url.endsWith("0000.json"))).toHaveLength(2);
	});
	it("shares concurrent sync requests and refuses a mismatched package version", async () => {
		const { feed, fetcher } = await fixture();
		const [a, b] = await Promise.all([feed.sync("1", () => undefined), feed.sync("1", () => undefined)]);
		expect(a).toBe(b);
		expect(fetcher.mock.calls.filter(([url]) => url.includes("/git/ref/"))).toHaveLength(1);
		const mismatch = await feed.sync("2", () => undefined);
		expect(mismatch.status.error).toBe("content-invalid");
		expect(mismatch.abilities).toHaveLength(2);
	});
	it("loads summaries first, fetches detail on demand and shares/caches detail shard downloads", async () => {
		const data = distribution([[ability("first"), ability("second")]]);
		const full = JSON.parse(data.bodies[0].toString());
		full.abilities[0].description = "Full detailed description";
		data.bodies[0] = Buffer.from(JSON.stringify(full));
		data.index.shards[0].sha256 = createHash("sha256").update(data.bodies[0]).digest("hex");
		data.index.shards[0].sizeBytes = data.bodies[0].length;
		const summary = Buffer.from(
			JSON.stringify({
				...full,
				abilities: full.abilities.map((row: ReturnType<typeof ability>) => ({
					...row,
					description: "Summary",
					detailShard: data.index.shards[0].path,
				})),
			}),
		);
		const descriptor = {
			...data.index.shards[0],
			path: "search/mcp-cad-3d-0000.json",
			sha256: createHash("sha256").update(summary).digest("hex"),
			sizeBytes: summary.length,
		};
		const index = { ...data.index, searchShards: [descriptor] };
		const rootDir = await mkdtemp(join(tmpdir(), "567-discovery-search-"));
		roots.push(rootDir);
		const fetcher = vi.fn(async (url: string) => {
			if (url.includes("/git/ref/")) return Response.json({ object: { sha: revision } });
			if (url.endsWith("index.json")) return Response.json(index);
			if (url.endsWith(descriptor.path)) return new Response(summary);
			if (url.endsWith(data.index.shards[0].path)) return new Response(data.bodies[0]);
			return new Response(null, { status: 404 });
		});
		const feed = new McpDiscoveryFeed({ rootDir, repository: "https://github.com/example/catalog", fetch: fetcher });
		const snapshot = await feed.sync("1", () => undefined);
		expect(snapshot.abilities).toHaveLength(2);
		expect(snapshot.abilities[0].description).toBe("Summary");
		expect(fetcher.mock.calls.filter(([url]) => url.includes("/shards/"))).toHaveLength(0);
		const [first, second] = await Promise.all([
			feed.detail("first", "2026.10.4"),
			feed.detail("second", "2026.10.4"),
		]);
		expect(first.description).toBe("Full detailed description");
		expect(second.slug).toBe("second");
		expect(first.mcpMetadata.installable).toBe(false);
		expect(fetcher.mock.calls.filter(([url]) => url.includes("/shards/"))).toHaveLength(1);
		await feed.detail("first", "2026.10.4");
		expect(fetcher.mock.calls.filter(([url]) => url.includes("/shards/"))).toHaveLength(1);
		await expect(feed.detail("first", "stale-version")).rejects.toThrow("changed");
		const restarted = new McpDiscoveryFeed({
			rootDir,
			repository: "https://github.com/example/catalog",
			fetch: async () => {
				throw new Error("offline");
			},
		});
		expect((await restarted.cached())?.abilities[0].description).toBe("Summary");
		expect((await restarted.detail("first", "2026.10.4")).description).toBe("Full detailed description");
	});

	it("converts hanging requests into retryable timeout state", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "567-discovery-timeout-"));
		roots.push(rootDir);
		const fetcher = vi.fn(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) =>
					init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
				),
		);
		const feed = new McpDiscoveryFeed({
			rootDir,
			repository: "https://github.com/example/catalog",
			fetch: fetcher,
			timeoutMs: 5,
			retryDelayMs: 0,
		});
		const result = await feed.sync("1", () => undefined);
		expect(result.status.error).toBe("timeout");
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
});
