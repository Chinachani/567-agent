// @vitest-environment jsdom
import type { OpenMarketplaceDiscoverySearch, OpenMarketplaceSourceSnapshot } from "@preload/api";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDiscoverySearch } from "./useDiscoverySearch";

const snapshots: OpenMarketplaceSourceSnapshot[] = [
	{
		sourceId: "official",
		source: {
			id: "official",
			name: "Official",
			type: "github",
			repository: "https://github.com/example/catalog",
			archiveUrl: "https://example.com/catalog.zip",
			ref: "main",
			enabled: true,
			builtin: true,
			autoUpdate: true,
			priority: 0,
			createdAt: "",
			updatedAt: "",
		},
		marketplaceVersion: "1",
		repository: "https://github.com/example/catalog",
		abilities: [],
		syncedAt: null,
		stale: false,
		discovery: {
			protocol: 2,
			revision: "a".repeat(40),
			version: "v2",
			total: 1000,
			loaded: 0,
			failedShards: 0,
			invalidRecords: 0,
			syncing: false,
		},
	},
];

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

it("paints the searching state before IPC, cancels changed queries and ignores late progress", async () => {
	vi.useFakeTimers();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	const frames: FrameRequestCallback[] = [];
	vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
		frames.push(callback);
		return frames.length;
	});
	const unsubscribe = vi.fn();
	let publish!: (value: OpenMarketplaceDiscoverySearch) => void;
	let finish!: (value: OpenMarketplaceDiscoverySearch) => void;
	const search = vi.fn().mockImplementation(
		() =>
			new Promise<OpenMarketplaceDiscoverySearch>((resolve) => {
				finish = resolve;
			}),
	);
	const cancel = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("vetta", {
		abilities: {
			searchDiscovery: search,
			cancelDiscoverySearch: cancel,
			onDiscoverySearchUpdated: (listener: typeof publish) => {
				publish = listener;
				return unsubscribe;
			},
		},
	});
	const view = renderHook(({ keyword }) => useDiscoverySearch(snapshots, { keyword, filters: {} }, true), {
		initialProps: { keyword: "first" },
	});
	expect(view.result.current.running).toBe(true);
	expect(view.result.current.total).toBe(1000);
	expect(search).not.toHaveBeenCalled();
	await act(async () => {
		frames.shift()?.(1);
	});
	expect(search).not.toHaveBeenCalled();
	await act(async () => {
		frames.shift()?.(2);
	});
	expect(search).toHaveBeenCalledOnce();
	expect(search.mock.calls[0][2]).toMatchObject({ keyword: "first", offset: 0, limit: 60 });
	const old = {
		requestId: search.mock.calls[0][0],
		sourceId: "official",
		abilities: [],
		progress: {
			revision: "a".repeat(40),
			version: "v2",
			matched: 7,
			scanned: 100,
			total: 1000,
			running: true,
			complete: false,
			failures: [],
		},
	};
	const oldPublish = publish;
	const oldFinish = finish;
	await act(async () => {
		oldPublish(old);
	});
	expect(view.result.current.matched).toBe(7);
	view.rerender({ keyword: "second" });
	expect(cancel).toHaveBeenCalledWith(old.requestId);
	expect(view.result.current.matched).toBe(0);
	await act(async () => {
		oldPublish(old);
		oldFinish(old);
	});
	expect(view.result.current.matched).toBe(0);
	await act(async () => {
		frames.shift()?.(3);
		frames.shift()?.(4);
	});
	expect(search).toHaveBeenCalledTimes(2);
	expect(search.mock.calls[1][2]).toMatchObject({ keyword: "second" });
	view.unmount();
	expect(cancel).toHaveBeenCalledWith(search.mock.calls[1][0]);
	expect(unsubscribe).toHaveBeenCalledTimes(2);
	await act(async () => {
		finish({ ...old, requestId: search.mock.calls[1][0] });
	});
});

it("does not start downloading if the page closes before its first paint", async () => {
	vi.useFakeTimers();
	vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
	vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);
	const search = vi.fn();
	const cancel = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("vetta", {
		abilities: {
			searchDiscovery: search,
			cancelDiscoverySearch: cancel,
			onDiscoverySearchUpdated: () => () => undefined,
		},
	});
	const view = renderHook(() => useDiscoverySearch(snapshots, { keyword: "", filters: {} }, true));
	view.unmount();
	await act(async () => {
		await vi.runAllTimersAsync();
	});
	expect(search).not.toHaveBeenCalled();
	expect(cancel).toHaveBeenCalledOnce();
});
