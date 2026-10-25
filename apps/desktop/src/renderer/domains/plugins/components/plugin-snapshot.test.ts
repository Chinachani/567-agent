import { describe, expect, it, vi } from "vitest";
import { loadPluginSnapshot } from "./plugin-snapshot";

interface InstalledFixture {
	id: string;
	enabled: boolean;
	version: number;
}

interface LoadedFixture {
	id: string;
	activation: number;
}

describe("loadPluginSnapshot", () => {
	it("reloads only targeted plugins and preserves installed ordering", async () => {
		const previousA = { id: "a", activation: 1 };
		const previousB = { id: "b", activation: 1 };
		const loader = vi.fn(
			async (plugin: InstalledFixture): Promise<LoadedFixture> => ({
				id: plugin.id,
				activation: plugin.version,
			}),
		);

		const result = await loadPluginSnapshot(
			[
				{ id: "b", enabled: true, version: 2 },
				{ id: "a", enabled: true, version: 2 },
			],
			[previousA, previousB],
			new Set(["b"]),
			loader,
			vi.fn(),
		);

		expect(loader).toHaveBeenCalledOnce();
		expect(loader).toHaveBeenCalledWith({ id: "b", enabled: true, version: 2 });
		expect(result).toEqual([{ id: "b", activation: 2 }, previousA]);
		expect(result[1]).toBe(previousA);
	});

	it("keeps the last-known-good activation when a targeted reload fails", async () => {
		const previous = { id: "demo", activation: 1 };
		const error = new Error("load failed");
		const onLoadError = vi.fn();
		const result = await loadPluginSnapshot(
			[{ id: "demo", enabled: true, version: 2 }],
			[previous],
			new Set(["demo"]),
			async () => {
				throw error;
			},
			onLoadError,
		);

		expect(result).toEqual([previous]);
		expect(result[0]).toBe(previous);
		expect(onLoadError).toHaveBeenCalledWith({ id: "demo", enabled: true, version: 2 }, error);
	});

	it("removes disabled plugins and loads newly visible plugins even outside the target set", async () => {
		const loader = vi.fn(
			async (plugin: InstalledFixture): Promise<LoadedFixture> => ({
				id: plugin.id,
				activation: plugin.version,
			}),
		);
		const result = await loadPluginSnapshot(
			[
				{ id: "disabled", enabled: false, version: 2 },
				{ id: "new", enabled: true, version: 1 },
			],
			[{ id: "disabled", activation: 1 }],
			new Set(["other"]),
			loader,
			vi.fn(),
		);

		expect(result).toEqual([{ id: "new", activation: 1 }]);
		expect(loader).toHaveBeenCalledOnce();
	});
});

it("yields before activation and publishes a ready sidebar entry without waiting for an unrelated plugin", async () => {
	let resolveSlow!: (value: LoadedFixture) => void;
	let paint!: () => void;
	const painted = new Promise<void>((resolve) => {
		paint = resolve;
	});
	const slow = new Promise<LoadedFixture>((resolve) => {
		resolveSlow = resolve;
	});
	const load = vi.fn(async (plugin: InstalledFixture) =>
		plugin.id === "slow" ? slow : { id: plugin.id, activation: 1 },
	);
	const progress = vi.fn();
	const loading = loadPluginSnapshot(
		[
			{ id: "canvas", enabled: true, version: 1 },
			{ id: "slow", enabled: true, version: 1 },
		],
		[],
		undefined,
		load,
		vi.fn(),
		{ beforeLoad: () => painted, onProgress: progress },
	);
	expect(load).not.toHaveBeenCalled();
	paint();
	await vi.waitFor(() => expect(progress).toHaveBeenCalledWith([{ id: "canvas", activation: 1 }]));
	resolveSlow({ id: "slow", activation: 1 });
	expect(await loading).toEqual([
		{ id: "canvas", activation: 1 },
		{ id: "slow", activation: 1 },
	]);
});
