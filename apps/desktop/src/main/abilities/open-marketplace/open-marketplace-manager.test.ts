import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	MarketplaceSource,
	OpenMarketplaceDiscoverySearch,
	OpenMarketplaceSnapshot,
} from "../../../preload/api-types/abilities";
import { discoveryQuerySchema } from "../../../shared/mcp-discovery";
import { MarketplaceSourceStore } from "./marketplace-source-store";
import { OpenMarketplaceManager } from "./open-marketplace-manager";

const { marketplaceLog } = vi.hoisted(() => ({
	marketplaceLog: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../../logger", () => ({ getAppLogger: () => marketplaceLog }));

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "vetta-marketplace-manager-test-"));
	temporaryRoots.push(root);
	return root;
}

function source(id: string, priority: number, autoUpdate = true): MarketplaceSource {
	return {
		id,
		name: id,
		type: "github",
		repository: `https://github.com/example/${id}`,
		archiveUrl: `https://github.com/example/${id}/archive/refs/heads/main.zip`,
		ref: "main",
		enabled: true,
		builtin: false,
		autoUpdate,
		priority,
		createdAt: "2026-07-28T00:00:00.000Z",
		updatedAt: "2026-07-28T00:00:00.000Z",
	};
}

function snapshot(sourceId: string): OpenMarketplaceSnapshot {
	return {
		sourceId,
		abilities: [],
		marketplaceVersion: "1.0.0",
		repository: `https://github.com/example/${sourceId}`,
		syncedAt: "2026-07-28T00:00:00.000Z",
		stale: false,
	};
}

function memoryCredentialStore() {
	const values = new Map<string, string>();
	return {
		store: {
			has: (sourceId: string) => values.has(sourceId),
			get: (sourceId: string) => values.get(sourceId),
			set: (sourceId: string, token: string) => values.set(sourceId, token.trim()),
			remove: (sourceId: string) => values.delete(sourceId),
		},
		values,
	};
}

afterEach(async () => {
	marketplaceLog.error.mockClear();
	await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("OpenMarketplaceManager", () => {
	it("isolates source failures and keeps source priority order", async () => {
		const root = await temporaryRoot();
		const sources = [source("first", 100), source("broken", 200)];
		const credentials = memoryCredentialStore();
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: sources });
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.11",
			store,
			cacheRoot: join(root, "cache"),
			credentialStore: credentials.store,
			workerFactory: (item) => ({
				list:
					item.id === "broken"
						? vi.fn(async () => Promise.reject(new Error("offline")))
						: vi.fn(async () => snapshot(item.id)),
				listCached: vi.fn(async () => snapshot(item.id)),
				refresh: vi.fn(async () => snapshot(item.id)),
				install: vi.fn(async () => undefined),
				prepareMcp: vi.fn(async () => ({ type: "http" as const, url: "https://mcp.example.com" })),
				mcpSetupStatus: vi.fn(async () => ({})),
			}),
		});

		const catalog = await manager.list();

		expect(catalog.snapshots.map((item) => item.source.id)).toEqual(["first"]);
		expect(catalog.failedSourceIds).toEqual(["broken"]);
		expect(catalog.sources.map((item) => item.id)).toEqual(["first", "broken"]);
		expect(marketplaceLog.error).toHaveBeenCalledWith(
			"marketplace source collection failed",
			expect.objectContaining({
				sourceId: "broken",
				sourceName: "broken",
				repository: "https://github.com/example/broken",
				operation: "list",
			}),
			expect.objectContaining({ message: "offline" }),
		);
	});

	it("uses cached data when auto update is disabled and routes installs by source", async () => {
		const root = await temporaryRoot();
		const cached = source("cached", 100, false);
		const credentials = memoryCredentialStore();
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: [cached] });
		const list = vi.fn(async () => snapshot(cached.id));
		const listCached = vi.fn(async () => snapshot(cached.id));
		const install = vi.fn(async () => undefined);
		const prepareMcp = vi.fn(async () => ({ type: "http" as const, url: "https://mcp.example.com" }));
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.11",
			store,
			cacheRoot: join(root, "cache"),
			credentialStore: credentials.store,
			workerFactory: () => ({
				list,
				listCached,
				refresh: list,
				install,
				prepareMcp,
				mcpSetupStatus: vi.fn(async () => ({})),
			}),
		});

		await manager.list();
		await manager.install("plugin", "demo", cached.id);
		await manager.prepareMcp("demo-mcp", cached.id);

		expect(list).not.toHaveBeenCalled();
		expect(listCached).toHaveBeenCalledOnce();
		expect(install).toHaveBeenCalledWith("plugin", "demo");
		expect(prepareMcp).toHaveBeenCalledWith("demo-mcp");
	});

	it("uses a different cache directory after source configuration changes", async () => {
		const root = await temporaryRoot();
		const catalog = source("catalog", 100);
		const credentials = memoryCredentialStore();
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: [catalog] });
		const cacheRoots: string[] = [];
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.11",
			store,
			cacheRoot: join(root, "cache"),
			credentialStore: credentials.store,
			workerFactory: (item, cacheRoot) => {
				cacheRoots.push(cacheRoot);
				return {
					list: vi.fn(async () => snapshot(item.id)),
					listCached: vi.fn(async () => snapshot(item.id)),
					refresh: vi.fn(async () => snapshot(item.id)),
					install: vi.fn(async () => undefined),
					prepareMcp: vi.fn(async () => ({ type: "http" as const, url: "https://mcp.example.com" })),
					mcpSetupStatus: vi.fn(async () => ({})),
				};
			},
		});

		await manager.list();
		await manager.list();
		manager.updateSource(catalog.id, { autoUpdate: false, name: "Renamed" });
		await manager.list();
		manager.updateSource(catalog.id, { enabled: false });
		expect((await manager.list()).snapshots).toEqual([]);
		manager.updateSource(catalog.id, { enabled: true });
		await manager.refreshSource(catalog.id);
		expect(cacheRoots).toHaveLength(1);
		manager.updateSource(catalog.id, { ref: "next" });
		await manager.list();

		expect(cacheRoots).toHaveLength(2);
		expect(cacheRoots[0]).not.toBe(cacheRoots[1]);
		expect(cacheRoots[0]).toContain(join("cache", catalog.id));
		expect(cacheRoots[1]).toContain(join("cache", catalog.id));
	});

	it("cancels only the changed source and rejects late results after update or removal", async () => {
		const root = await temporaryRoot();
		const sources = [source("first", 100), source("second", 200)];
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: sources });
		const pending = new Map<string, { signal: AbortSignal; finish: () => void }>();
		const manager = new OpenMarketplaceManager({
			appVersion: "1.5.4",
			store,
			cacheRoot: join(root, "cache"),
			credentialStore: memoryCredentialStore().store,
			workerFactory: (item) => ({
				list: async () => snapshot(item.id),
				listCached: async () => snapshot(item.id),
				refresh: async () => snapshot(item.id),
				install: async () => undefined,
				prepareMcp: async () => ({ type: "http" as const, url: "https://mcp.example.com" }),
				mcpSetupStatus: async () => ({}),
				searchDiscovery: (requestId, _query, signal) =>
					new Promise<OpenMarketplaceDiscoverySearch>((resolve) => {
						pending.set(item.id, {
							signal,
							finish: () =>
								resolve({
									requestId,
									sourceId: item.id,
									abilities: [],
									progress: {
										revision: "a".repeat(40),
										version: "v2",
										matched: 0,
										scanned: 0,
										total: 0,
										complete: true,
										running: false,
										failures: [],
									},
								}),
						});
					}),
			}),
		});
		const first = manager.searchDiscovery(
			"query-a",
			"first",
			discoveryQuerySchema.parse({}),
			new AbortController().signal,
			() => undefined,
		);
		const second = manager.searchDiscovery(
			"query-b",
			"second",
			discoveryQuerySchema.parse({}),
			new AbortController().signal,
			() => undefined,
		);
		const firstRejected = expect(first).rejects.toThrow();
		manager.updateSource("first", { ref: "next" });
		expect(pending.get("first")!.signal.aborted).toBe(true);
		expect(pending.get("second")!.signal.aborted).toBe(false);
		pending.get("first")!.finish();
		await firstRejected;
		const secondRejected = expect(second).rejects.toThrow();
		manager.removeSource("second");
		expect(pending.get("second")!.signal.aborted).toBe(true);
		pending.get("second")!.finish();
		await secondRejected;
		expect(manager.listSources().map((item) => item.id)).toEqual(["first"]);
	});

	it("publishes successful background updates to subscribers", async () => {
		const root = await temporaryRoot();
		const catalog = source("catalog", 100);
		const credentials = memoryCredentialStore();
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: [catalog] });
		let publishBackgroundUpdate: (() => void) | undefined;
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.11",
			store,
			cacheRoot: join(root, "cache"),
			credentialStore: credentials.store,
			workerFactory: (item, _cacheRoot, onBackgroundUpdate) => {
				publishBackgroundUpdate = onBackgroundUpdate;
				return {
					list: vi.fn(async () => snapshot(item.id)),
					listCached: vi.fn(async () => snapshot(item.id)),
					refresh: vi.fn(async () => snapshot(item.id)),
					install: vi.fn(async () => undefined),
					prepareMcp: vi.fn(async () => ({ type: "http" as const, url: "https://mcp.example.com" })),
					mcpSetupStatus: vi.fn(async () => ({})),
				};
			},
		});
		const listener = vi.fn();
		const unsubscribe = manager.subscribeToUpdates(listener);
		await manager.list();

		publishBackgroundUpdate?.();

		expect(listener).toHaveBeenCalledWith(catalog.id);
		unsubscribe();
		publishBackgroundUpdate?.();
		expect(listener).toHaveBeenCalledOnce();
	});

	it("stores source credentials outside source metadata and can clear them", async () => {
		const root = await temporaryRoot();
		const credentials = memoryCredentialStore();
		const store = new MarketplaceSourceStore({ filePath: join(root, "sources.json"), defaultSources: [] });
		const manager = new OpenMarketplaceManager({
			appVersion: "0.5.11",
			store,
			cacheRoot: join(root, "cache"),
			credentialStore: credentials.store,
			workerFactory: () => ({
				list: vi.fn(async () => snapshot("unused")),
				listCached: vi.fn(async () => snapshot("unused")),
				refresh: vi.fn(async () => snapshot("unused")),
				install: vi.fn(async () => undefined),
				prepareMcp: vi.fn(async () => ({ type: "http" as const, url: "https://mcp.example.com" })),
				mcpSetupStatus: vi.fn(async () => ({})),
			}),
		});

		const added = manager.addSource({ repository: "example/private", credential: " secret-token " });
		expect(added.credentialConfigured).toBe(true);
		expect(credentials.values.get(added.id)).toBe("secret-token");
		expect(JSON.stringify(store.list())).not.toContain("secret-token");

		manager.clearSourceCredential(added.id);
		expect(manager.listSources().find((item) => item.id === added.id)?.credentialConfigured).toBeUndefined();
	});
});
