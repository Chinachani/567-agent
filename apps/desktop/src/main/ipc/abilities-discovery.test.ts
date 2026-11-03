import { EventEmitter } from "node:events";
import type { IpcRenderer, WebContents } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import type { OpenMarketplaceDiscoverySearch } from "../../preload/api-types/abilities.js";
import { createAbilitiesApi } from "../../preload/apis/abilities.js";
import { discoveryQuerySchema } from "../../shared/mcp-discovery.js";
import { DiscoverySearchHost } from "../abilities/open-marketplace/discovery-search-host.js";

const state = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	search: vi.fn(),
	detail: vi.fn(),
}));
vi.mock("electron", () => ({
	app: { getVersion: () => "1.5.4" },
	BrowserWindow: { getAllWindows: () => [] },
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => state.handlers.set(channel, handler),
		removeHandler: (channel: string) => state.handlers.delete(channel),
	},
}));
vi.mock("../abilities/open-marketplace/open-marketplace-manager.js", () => ({
	getOpenMarketplaceManager: () => ({
		subscribeToUpdates: () => () => {},
		searchDiscovery: state.search,
		getDiscoveryDetail: state.detail,
	}),
}));
vi.mock("../abilities/ability-ledger.js", () => ({ readAbilityLedger: vi.fn(), recordAbilityInstall: vi.fn() }));
vi.mock("../abilities/presentation/local-ability-presentations.js", () => ({ listLocalAbilityPresentations: vi.fn() }));
vi.mock("../app-monitor/app-monitor-service.js", () => ({ recordAppMonitorEvent: vi.fn() }));
vi.mock("../mcp/mcp-settings-service.js", () => ({ readMcpConfig: vi.fn() }));
afterEach(() => {
	vi.clearAllMocks();
	state.handlers.clear();
});
function owner() {
	return Object.assign(new EventEmitter(), {
		mainFrame: {},
		isDestroyed: () => false,
		send: vi.fn(),
	}) as unknown as WebContents;
}
function result(id: string): OpenMarketplaceDiscoverySearch {
	return {
		requestId: id,
		sourceId: "official",
		abilities: [],
		progress: {
			revision: "a".repeat(40),
			version: "v2",
			matched: 0,
			total: 0,
			scanned: 0,
			complete: true,
			running: false,
			failures: [],
		},
	};
}

it("bridges the public preload contract with trusted source/frame checks and strict query/reference validation", async () => {
	const { registerAbilitiesIpc } = await import("./abilities.js");
	const window = owner();
	const event = { sender: window, senderFrame: window.mainFrame };
	const dispose = registerAbilitiesIpc(window);
	state.search.mockImplementation(async (id: string) => result(id));
	state.detail.mockResolvedValue({ installable: false });
	const api = createAbilitiesApi({
		invoke: async (channel: string, ...args: unknown[]) => state.handlers.get(channel)!(event, ...args),
	} as IpcRenderer).abilities;
	try {
		expect(await api.searchDiscovery("query-1", "official", discoveryQuerySchema.parse({ keyword: "cad" }))).toEqual(
			result("query-1"),
		);
		const reference = {
			revision: "a".repeat(40),
			category: "cad-3d" as const,
			searchPath: "v2/search/mcp-cad-3d-000000.json",
		};
		await api.getDiscoveryDetail("official", "cad", "v2", reference);
		expect(state.detail).toHaveBeenCalledWith("official", "cad", "v2", reference);
		for (const invalid of [
			{ sender: owner(), senderFrame: window.mainFrame },
			{ sender: window, senderFrame: {} },
			{ sender: window, senderFrame: null },
		]) {
			for (const [channel, args] of [
				["vetta:abilities:search-discovery", ["q", "official", {}]],
				["vetta:abilities:cancel-discovery-search", ["q"]],
				["vetta:abilities:get-discovery-detail", ["official", "cad", "v2", reference]],
			] as const)
				expect(() => state.handlers.get(channel)!(invalid, ...args)).toThrow("Untrusted");
		}
		expect(() =>
			state.handlers.get("vetta:abilities:search-discovery")!(event, "q", "official", { limit: 100000 }),
		).toThrow();
		expect(() => state.handlers.get("vetta:abilities:search-discovery")!(event, "../", "official", {})).toThrow();
		expect(() =>
			state.handlers.get("vetta:abilities:get-discovery-detail")!(event, "official", "cad", "v2", {
				...reference,
				revision: "main",
			}),
		).toThrow();
	} finally {
		dispose();
	}
	expect(state.handlers.size).toBe(0);
	expect(window.listenerCount("destroyed")).toBe(0);
});

it("cancels superseded, navigated and disposed queries and suppresses late progress", async () => {
	const window = owner();
	const jobs: Array<{
		signal: AbortSignal;
		update: (value: OpenMarketplaceDiscoverySearch) => void;
		resolve: (value: OpenMarketplaceDiscoverySearch) => void;
	}> = [];
	const host = new DiscoverySearchHost(
		window,
		(_id, _source, _query, signal, update) => new Promise((resolve) => jobs.push({ signal, update, resolve })),
	);
	const first = host.run("first", "official", discoveryQuerySchema.parse({}));
	const firstRejected = expect(first).rejects.toThrow();
	const second = host.run("second", "official", discoveryQuerySchema.parse({ keyword: "changed" }));
	const secondRejected = expect(second).rejects.toThrow();
	expect(jobs[0].signal.aborted).toBe(true);
	jobs[0].update(result("first"));
	expect(window.send).not.toHaveBeenCalled();
	jobs[0].resolve(result("first"));
	await firstRejected;
	jobs[1].update(result("second"));
	expect(window.send).toHaveBeenCalledWith("vetta:abilities:discovery-search-updated", result("second"));
	window.emit("did-start-navigation", {}, "app://reload", false, true);
	expect(jobs[1].signal.aborted).toBe(true);
	jobs[1].resolve(result("second"));
	await secondRejected;
	const third = host.run("third", "official", discoveryQuerySchema.parse({}));
	const thirdRejected = expect(third).rejects.toThrow();
	host.dispose();
	expect(jobs[2].signal.aborted).toBe(true);
	jobs[2].resolve(result("third"));
	await thirdRejected;
	expect(window.listenerCount("did-start-navigation")).toBe(0);
});
