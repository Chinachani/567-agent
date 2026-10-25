export interface InstalledPluginSnapshotEntry {
	id: string;
	enabled: boolean;
}

export interface LoadedPluginSnapshotEntry {
	id: string;
}

export async function loadPluginSnapshot<
	TInstalled extends InstalledPluginSnapshotEntry,
	TLoaded extends LoadedPluginSnapshotEntry,
>(
	installedPlugins: readonly TInstalled[],
	previousPlugins: readonly TLoaded[],
	targetPluginIds: ReadonlySet<string> | undefined,
	loadPlugin: (plugin: TInstalled) => Promise<TLoaded>,
	onLoadError: (plugin: TInstalled, error: unknown) => void,
	options: {
		beforeLoad?: () => Promise<unknown>;
		onProgress?: (plugins: TLoaded[]) => void;
		concurrency?: number;
	} = {},
): Promise<TLoaded[]> {
	const previousById = new Map(previousPlugins.map((plugin) => [plugin.id, plugin]));
	const enabled = installedPlugins.filter((plugin) => plugin.enabled);
	const results = new Map<string, TLoaded>();
	let next = 0;
	const snapshot = () =>
		enabled.flatMap((plugin) => {
			const loaded = results.get(plugin.id);
			return loaded ? [loaded] : [];
		});
	const worker = async () => {
		while (next < enabled.length) {
			const plugin = enabled[next++];
			const previous = previousById.get(plugin.id);
			if (targetPluginIds && !targetPluginIds.has(plugin.id) && previous) results.set(plugin.id, previous);
			else {
				await options.beforeLoad?.();
				try {
					results.set(plugin.id, await loadPlugin(plugin));
				} catch (error) {
					onLoadError(plugin, error);
					if (previous) results.set(plugin.id, previous);
				}
			}
			options.onProgress?.(snapshot());
		}
	};
	const concurrency = Math.max(1, Math.min(enabled.length, options.concurrency ?? 2));
	await Promise.all(Array.from({ length: concurrency }, worker));
	return snapshot();
}
