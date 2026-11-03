import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoveryQuerySchema } from "../../../shared/mcp-discovery.js";
import { DiscoveryFileCache } from "./mcp-discovery-cache.js";
import { McpDiscoveryCatalogFeed } from "./mcp-discovery-catalog-feed.js";
import { DiscoveryTransport } from "./mcp-discovery-transport.js";
import { McpDiscoveryV2Feed } from "./mcp-discovery-v2-feed.js";
import {
	descriptor,
	generatedCatalog,
	officialFiles,
	TEST_REPOSITORY,
	TEST_REVISION,
} from "./mcp-discovery-v2-fixture.js";
import {
	parseDiscoveryDataV2,
	parseDiscoveryIndexV2,
	parseDiscoveryPageV2,
	recordFacets,
} from "./mcp-discovery-v2-schema.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function root() {
	const path = await mkdtemp(join(tmpdir(), "567-discovery-v2-"));
	roots.push(path);
	return path;
}
async function setup(inputFiles?: Map<string, () => Buffer>, budget?: number) {
	const files = inputFiles ?? (await officialFiles());
	const rootDir = await root();
	const failed = new Set<string>();
	const corrupt = new Set<string>();
	const fetcher = vi.fn(async (url: string) => {
		if (url.includes("/git/ref/")) return Response.json({ object: { sha: TEST_REVISION } });
		expect(url).toContain(`/${TEST_REVISION}/`);
		const path = url.split(`/${TEST_REVISION}/`)[1];
		if (failed.has(path)) return new Response(null, { status: 503 });
		const file = files.get(path);
		if (!file) return new Response(null, { status: 404 });
		const bytes = file();
		return new Response(new Uint8Array(corrupt.has(path) ? Buffer.alloc(bytes.length) : bytes));
	});
	const options = { rootDir, repository: TEST_REPOSITORY, fetch: fetcher, retryDelayMs: 0, cacheBudgetBytes: budget };
	const feed = new McpDiscoveryV2Feed(options);
	return { feed, options, files, fetcher, failed, corrupt, rootDir };
}
const signal = () => new AbortController().signal;
const query = (keyword = "", offset = 0, limit = 60) => discoveryQuerySchema.parse({ keyword, offset, limit });

describe("MCP v2 browse/search/details flow", () => {
	it("validates official bytes, publishes partial summaries, loads details only on demand and restarts offline", async () => {
		const { feed, fetcher, options } = await setup();
		const root = await feed.sync(await feed.pinRevision());
		expect(root.index.recordCount).toBe(3);
		expect(fetcher).toHaveBeenCalledTimes(2);
		const updates: number[] = [];
		const found = await feed.search(query(), signal(), (result) => updates.push(result.progress.matched));
		expect(found.progress).toMatchObject({ complete: true, matched: 3, scanned: 3 });
		expect(updates).toContain(2);
		expect(fetcher.mock.calls.some(([url]) => url.includes("/shards/"))).toBe(false);
		const blender = found.rows.find((row) => row.ability.slug === "blender-example");
		if (!blender) throw new Error("Missing Blender");
		const [a, b] = await Promise.all([
			feed.detail(blender.ability.slug, root.index.catalogVersion, blender.reference),
			feed.detail(blender.ability.slug, root.index.catalogVersion, blender.reference),
		]);
		expect(a).toEqual(b);
		expect(a.description).toContain("Blender");
		expect(a.detail.i18n?.zh?.description ?? a.description).toBe(a.description);
		expect(fetcher.mock.calls.filter(([url]) => url.includes("/shards/"))).toHaveLength(1);
		const offline = vi.fn(async () => {
			throw new Error("offline");
		});
		const restarted = new McpDiscoveryV2Feed({ ...options, fetch: offline });
		expect(
			(await restarted.search(query("Blender"), signal(), () => undefined)).rows.map((row) => row.ability.slug),
		).toEqual(["blender-example"]);
		expect((await restarted.detail(a.slug, root.index.catalogVersion, blender.reference)).description).toBe(
			a.description,
		);
		expect(offline).not.toHaveBeenCalled();
	});
	it("shares one detail shard across different records and keeps an in-flight scan pinned during refresh", async () => {
		const { files } = generatedCatalog(1, 2);
		const context = await setup(files);
		await context.feed.sync(TEST_REVISION);
		const found = await context.feed.search(query(), signal(), () => undefined);
		const details = await Promise.all(
			found.rows.map(({ ability, reference }) => context.feed.detail(ability.slug, "test-v2", reference)),
		);
		expect(details.map((item) => item.slug)).toEqual(found.rows.map((row) => row.ability.slug));
		expect(context.fetcher.mock.calls.filter(([url]) => url.includes("/shards/"))).toHaveLength(1);

		let release!: () => void;
		let started!: () => void;
		const began = new Promise<void>((resolve) => {
			started = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const urls: string[] = [];
		const feed = new McpDiscoveryV2Feed({
			...context.options,
			rootDir: await root(),
			fetch: async (url) => {
				urls.push(url);
				if (url.includes("/search/")) {
					started();
					await gate;
				}
				const path = new URL(url).pathname.split("/").slice(4).join("/");
				const bytes = files.get(path)?.();
				return bytes ? new Response(new Uint8Array(bytes)) : new Response(null, { status: 404 });
			},
		});
		await feed.sync(TEST_REVISION);
		const pending = feed.search(query(), signal(), () => undefined);
		await began;
		await feed.sync("b".repeat(40));
		release();
		expect((await pending).progress).toMatchObject({ revision: TEST_REVISION, complete: true, matched: 2 });
		expect(urls.filter((url) => url.includes("/search/")).every((url) => url.includes(TEST_REVISION))).toBe(true);
		expect((await feed.cached())?.revision).toBe("b".repeat(40));
	});
	it.each(["version", "category"])("rejects detail %s mismatches before caching the shard", async (field) => {
		const { files, index, entries } = generatedCatalog(1, 2);
		const entry = entries[0];
		const raw = JSON.parse(files.get(entry.detail.path)!().toString());
		raw.abilities[0][field] = field === "version" ? "other" : "web-search";
		const detail = Buffer.from(JSON.stringify(raw));
		files.set(entry.detail.path, () => detail);
		entry.detail = descriptor(entry.detail.path, detail);
		const category = index.categories["cad-3d"]!;
		const pageRaw = JSON.parse(files.get(category.firstPage.path)!().toString());
		pageRaw.entries = [entry];
		const page = Buffer.from(JSON.stringify(pageRaw));
		files.set(category.firstPage.path, () => page);
		category.firstPage = descriptor(category.firstPage.path, page);
		index.totalBytes.pages = page.length;
		index.totalBytes.detail = detail.length;
		files.set("v2/index.json", () => Buffer.from(JSON.stringify(index)));
		const { feed, fetcher } = await setup(files);
		await feed.sync(TEST_REVISION);
		const found = (await feed.search(query(), signal(), () => undefined)).rows[0];
		await expect(feed.detail(found.ability.slug, "test-v2", found.reference)).rejects.toThrow("identity mismatch");
		await expect(feed.detail(found.ability.slug, "test-v2", found.reference)).rejects.toThrow("identity mismatch");
		expect(fetcher.mock.calls.filter(([url]) => url.includes("/shards/"))).toHaveLength(2);
	});
	it("scans later pages, paginates without duplicates and prunes impossible facets without fetching their data", async () => {
		const { files } = generatedCatalog();
		const { feed, fetcher } = await setup(files);
		await feed.sync(TEST_REVISION);
		const first = await feed.search(query("", 0, 60), signal(), () => undefined);
		const second = await feed.search(query("", 60, 60), signal(), () => undefined);
		expect(first.rows).toHaveLength(60);
		expect(second.rows).toHaveLength(5);
		expect(new Set([...first.rows, ...second.rows].map((row) => row.ability.slug)).size).toBe(65);
		expect(second.progress).toMatchObject({ matched: 65, complete: true });
		const fresh = await setup(files);
		await fresh.feed.sync(TEST_REVISION);
		const filtered = await fresh.feed.search(
			discoveryQuerySchema.parse({ filters: { tags: ["last"], platforms: ["linux"], authentication: ["unknown"] } }),
			signal(),
			() => undefined,
		);
		expect(filtered.rows.map((row) => row.ability.slug)).toEqual(["item-00000064"]);
		expect(fresh.fetcher.mock.calls.filter(([url]) => url.includes("/search/"))).toHaveLength(1);
		expect(fetcher.mock.calls.filter(([url]) => url.includes("/shards/"))).toHaveLength(0);
	});
	it("allows more than 100000 records, 250 shards and 100 MiB detail data with bounded result windows", async () => {
		const { files, index } = generatedCatalog(251, 401, 1200);
		expect(index.recordCount).toBeGreaterThan(100000);
		expect(index.totalBytes.detail).toBeGreaterThan(100 * 1024 * 1024);
		const { feed, fetcher } = await setup(files, 0);
		await feed.sync(TEST_REVISION);
		let largestWindow = 0;
		const found = await feed.search(query("item-00100650", 0, 10), signal(), (result) => {
			largestWindow = Math.max(largestWindow, result.rows.length);
		});
		expect(found.progress).toMatchObject({ complete: true, matched: 1, scanned: 100651 });
		expect(found.rows[0].ability.slug).toBe("item-00100650");
		expect(largestWindow).toBe(1);
		expect(fetcher.mock.calls.filter(([url]) => url.includes("/search/"))).toHaveLength(251);
		expect(fetcher.mock.calls.some(([url]) => url.includes("/shards/"))).toBe(false);
	}, 30000);
	it("retains good results after a failed shard and retries only missing data; corruption never enters valid cache", async () => {
		const { feed, failed, corrupt, fetcher, rootDir } = await setup();
		await feed.sync(TEST_REVISION);
		const path = "v2/search/mcp-cad-3d-000000.json";
		corrupt.add(path);
		const partial = await feed.search(query(), signal(), () => undefined);
		expect(partial.progress).toMatchObject({
			complete: false,
			matched: 1,
			failures: [{ path, code: "content-invalid" }],
		});
		const goodRequests = fetcher.mock.calls.filter(([url]) => url.includes("/search/mcp-web-search-")).length;
		corrupt.clear();
		failed.add(path);
		expect((await feed.search(query(), signal(), () => undefined)).progress.complete).toBe(false);
		failed.clear();
		const complete = await feed.search(query(), signal(), () => undefined);
		expect(complete.progress).toMatchObject({ matched: 3, complete: true });
		expect(fetcher.mock.calls.filter(([url]) => url.includes("/search/mcp-web-search-"))).toHaveLength(goodRequests);
		const cacheFiles = await readdir(join(rootDir, "discovery-v2", "files"));
		for (const name of cacheFiles)
			expect(JSON.parse(await readFile(join(rootDir, "discovery-v2", "files", name), "utf8"))).toHaveProperty(
				"schemaVersion",
				2,
			);
	});
});

describe("v2 validation and compatibility", () => {
	it.each([
		"../escape.json",
		"/v2/pages/cad-3d/000000.json",
		"v2/pages/web-search/000000.json",
		"v2/pages/cad-3d/000000.json?query",
		"v2/pages/cad-3d/000000.json#fragment",
		"v2\\pages\\cad-3d\\000000.json",
	])("rejects untrusted locator %s", (path) => {
		const { index } = generatedCatalog(1);
		index.categories["cad-3d"]!.firstPage.path = path;
		expect(() => parseDiscoveryIndexV2(index)).toThrow();
	});
	it("rejects unsafe counts, versions, duplicate slugs and invalid detail identity; accepts future metadata", () => {
		const { index, files, entries } = generatedCatalog(1, 2);
		expect(() => parseDiscoveryIndexV2({ ...index, recordCount: Number.MAX_SAFE_INTEGER + 1 })).toThrow();
		expect(() => parseDiscoveryIndexV2({ ...index, schemaVersion: 9 })).toThrow();
		const entry = entries[0];
		const raw = parseDiscoveryDataV2(
			JSON.parse(files.get(entry.search.path)!().toString()),
			index,
			"cad-3d",
			entry,
			"search",
		);
		for (const abilities of [
			raw.slice(1),
			[raw[0], raw[0]],
			[{ ...raw[0], detailShard: "https://example.com" }, raw[1]],
			[{ ...raw[0], config: { command: "evil" } }, raw[1]],
			[{ ...raw[0], mcpMetadata: { ...raw[0].mcpMetadata, installable: true } }, raw[1]],
		]) {
			expect(() =>
				parseDiscoveryDataV2(
					{ schemaVersion: 2, catalogVersion: index.catalogVersion, category: "cad-3d", abilities },
					index,
					"cad-3d",
					entry,
					"search",
				),
			).toThrow();
		}
		const page = JSON.parse(files.get(index.categories["cad-3d"]!.firstPage.path)!().toString());
		page.entries.push(page.entries[0]);
		expect(() => parseDiscoveryPageV2(page, index, "cad-3d")).toThrow();
		const future = raw.map((row) => ({ ...row, mcpMetadata: { ...row.mcpMetadata, authentication: "future-auth" } }));
		expect(
			parseDiscoveryDataV2(
				{ schemaVersion: 2, catalogVersion: index.catalogVersion, category: "cad-3d", abilities: future },
				index,
				"cad-3d",
				{ ...entry, facets: recordFacets(future) },
				"search",
			)[0].mcpMetadata.authentication,
		).toBe("future-auth");
	});
	it("preserves future metadata keys without prototype mutation", () => {
		const { index, files, entries } = generatedCatalog(1, 2);
		const entry = entries[0];
		const raw = JSON.parse(files.get(entry.search.path)!().toString());
		for (const row of raw.abilities) {
			row.mcpMetadata.authentication = "__proto__";
			row.mcpMetadata.publisherType = "constructor";
		}
		entry.facets = recordFacets(raw.abilities);
		index.categories["cad-3d"]!.facets = entry.facets;
		const parsed = parseDiscoveryIndexV2(JSON.parse(JSON.stringify(index)));
		expect(Object.hasOwn(parsed.categories["cad-3d"]!.facets.authentication, "__proto__")).toBe(true);
		expect(parsed.categories["cad-3d"]!.facets.authentication.__proto__).toBe(2);
		const page = parseDiscoveryPageV2(
			{ schemaVersion: 2, catalogVersion: index.catalogVersion, category: "cad-3d", entries: [entry], next: null },
			parsed,
			"cad-3d",
		);
		expect(parseDiscoveryDataV2(raw, parsed, "cad-3d", page.entries[0], "search")).toHaveLength(2);
		expect(Object.getPrototypeOf(page.entries[0].facets.authentication)).toBeNull();
	});
	it("marks missing/cyclic pages and inconsistent statistics incomplete while retaining valid rows", async () => {
		for (const mode of ["missing", "cycle", "totals"]) {
			const { files, index } = generatedCatalog(65);
			if (mode === "missing") files.delete("v2/pages/cad-3d/000001.json");
			else if (mode === "totals") index.totalBytes.pages++;
			else {
				const first = index.categories["cad-3d"]!.firstPage;
				const page = JSON.parse(files.get(first.path)!().toString());
				page.next = first;
				const bytes = Buffer.from(JSON.stringify(page));
				files.set(first.path, () => bytes);
				index.categories["cad-3d"]!.firstPage = descriptor(first.path, bytes);
			}
			files.set("v2/index.json", () => Buffer.from(JSON.stringify(index)));
			const { feed } = await setup(files);
			await feed.sync(TEST_REVISION);
			const found = await feed.search(query(), signal(), () => undefined);
			expect(found.rows.length).toBeGreaterThan(0);
			expect(found.progress.complete).toBe(false);
			expect(found.progress.failures.length).toBeGreaterThan(0);
		}
	});
	it("falls back only on 404, keeps valid v2 after corruption, and remembers valid v1 fallback on restart", async () => {
		const ctx = await setup();
		const feed = new McpDiscoveryCatalogFeed(ctx.options);
		expect((await feed.sync("unrelated-install-version", () => undefined)).status.protocol).toBe(2);
		ctx.files.set("v2/index.json", () => Buffer.from('{"schemaVersion":99}'));
		expect((await feed.sync("1", () => undefined)).status).toMatchObject({
			protocol: 2,
			total: 3,
			error: "content-invalid",
		});
		expect(
			ctx.fetcher.mock.calls.some(
				([url]) => url === `https://raw.githubusercontent.com/example/catalog/${TEST_REVISION}/index.json`,
			),
		).toBe(false);
		ctx.files.delete("v2/index.json");
		ctx.files.set("index.json", () =>
			Buffer.from(
				JSON.stringify({
					schemaVersion: 1,
					catalogVersion: "legacy",
					marketplaceVersion: "1",
					recordCount: 0,
					categories: {},
					shards: [],
				}),
			),
		);
		const fallback = await feed.sync("1", () => undefined);
		expect(fallback.status).toMatchObject({ version: "legacy", loaded: 0 });
		expect(fallback.status.protocol).not.toBe(2);
		const restart = new McpDiscoveryCatalogFeed({
			...ctx.options,
			fetch: async () => {
				throw new Error("offline");
			},
		});
		expect((await restart.cached())?.status.version).toBe("legacy");
	});
	it("bounds disk LRU across revisions and leaves installation data untouched", async () => {
		const path = await root();
		const bytes = Buffer.from("first");
		const next = Buffer.from("second");
		await writeFile(join(path, "installed.json"), "keep");
		const cache = new DiscoveryFileCache(path, TEST_REPOSITORY, next.length);
		const ref = descriptor("v2/search/mcp-cad-3d-000000.json", bytes);
		const ref2 = descriptor("v2/search/mcp-cad-3d-000001.json", next);
		await cache.put(TEST_REVISION, ref, bytes);
		expect(await cache.read(TEST_REVISION, ref)).toEqual(bytes);
		await cache.put("b".repeat(40), ref2, next);
		expect(await cache.read(TEST_REVISION, ref)).toBeNull();
		expect(await cache.read("b".repeat(40), ref2)).toEqual(next);
		expect(await cache.read(TEST_REVISION, ref2)).toBeNull();
		expect(await readFile(join(path, "installed.json"), "utf8")).toBe("keep");
		await expect(cache.put(TEST_REVISION, ref, next)).rejects.toThrow();
		expect(await new DiscoveryFileCache(path, TEST_REPOSITORY, next.length).read("b".repeat(40), ref2)).toEqual(next);
	});
});

describe("bounded transport and cancellation", () => {
	it("enforces four slots and aborts queued requests", async () => {
		let active = 0;
		let peak = 0;
		const complete: Array<() => void> = [];
		const transport = new DiscoveryTransport({
			fetch: async () => {
				active++;
				peak = Math.max(peak, active);
				await new Promise<void>((resolve) => complete.push(resolve));
				active--;
				return new Response("ok");
			},
		});
		const first = Array.from({ length: 4 }, () => transport.download("https://example.com", 4));
		await vi.waitFor(() => expect(complete).toHaveLength(4));
		const controller = new AbortController();
		const waiting = transport.download("https://example.com", 4, controller.signal);
		const rejected = expect(waiting).rejects.toThrow();
		controller.abort();
		await rejected;
		for (const resolve of complete) resolve();
		await Promise.all(first);
		expect(peak).toBe(4);
	});
	it("checks actual streamed bytes without content length and retries timeout once", async () => {
		const cancelled = vi.fn();
		const transport = new DiscoveryTransport({
			fetch: async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(new Uint8Array(10));
						},
						cancel: cancelled,
					}),
				),
		});
		await expect(transport.download("https://example.com", 4)).rejects.toThrow("byte limit");
		expect(cancelled).toHaveBeenCalled();
		const fetcher = vi.fn(
			(_url: string, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				}),
		);
		await expect(
			new DiscoveryTransport({ fetch: fetcher, timeoutMs: 5, retryDelayMs: 0 }).download("https://example.com", 4),
		).rejects.toMatchObject({ code: "timeout" });
		expect(fetcher).toHaveBeenCalledTimes(2);
	});
	it("does not publish late results after cancelling a scan", async () => {
		const ctx = await setup();
		let started!: () => void;
		const began = new Promise<void>((resolve) => {
			started = resolve;
		});
		const feed = new McpDiscoveryV2Feed({
			...ctx.options,
			fetch: async (url, init) => {
				if (url.includes("/search/")) {
					started();
					return new Promise<Response>((_resolve, reject) =>
						init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
					);
				}
				return ctx.fetcher(url);
			},
		});
		await feed.sync(TEST_REVISION);
		const controller = new AbortController();
		const updates = vi.fn();
		const pending = feed.search(query(), controller.signal, updates);
		const rejection = expect(pending).rejects.toThrow();
		await began;
		const before = updates.mock.calls.length;
		controller.abort();
		await rejection;
		expect(updates).toHaveBeenCalledTimes(before);
	});
});
