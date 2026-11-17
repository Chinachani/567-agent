import type { Disposable, PluginFileExplorerChange, PluginFileExplorerEntry } from "@vetta-org/plugin-sdk";
import { logPluginRuntimeError } from "./plugin-runtime-log";

interface PluginFileExplorerListener<T> {
	readonly pluginId: string;
	readonly pluginVersion: string;
	readonly listener: (value: T) => void;
}

const selectionListeners = new Set<PluginFileExplorerListener<readonly PluginFileExplorerEntry[]>>();
const fileChangeListeners = new Set<PluginFileExplorerListener<readonly PluginFileExplorerChange[]>>();

export {
	bindFileExplorerHost as bindPluginFileExplorerHost,
	type FileExplorerHostAdapter as PluginFileExplorerHostAdapter,
	getFileExplorerSelection as getPluginFileExplorerSelection,
	getFileExplorerWorkspaceRoots as getPluginFileExplorerWorkspaceRoots,
	refreshFileExplorer as refreshPluginFileExplorer,
	revealFileExplorerPath as revealPluginFileExplorerPath,
} from "@shared/lib/file-explorer-host";

export function onPluginFileExplorerSelectionChanged(
	pluginId: string,
	pluginVersion: string,
	listener: (selection: readonly PluginFileExplorerEntry[]) => void,
): Disposable {
	const entry = { pluginId, pluginVersion, listener };
	selectionListeners.add(entry);
	return { dispose: () => selectionListeners.delete(entry) };
}

export function onPluginFileExplorerFilesChanged(
	pluginId: string,
	pluginVersion: string,
	listener: (changes: readonly PluginFileExplorerChange[]) => void,
): Disposable {
	const entry = { pluginId, pluginVersion, listener };
	fileChangeListeners.add(entry);
	return { dispose: () => fileChangeListeners.delete(entry) };
}

export function emitPluginFileExplorerSelectionChanged(selection: readonly PluginFileExplorerEntry[]): void {
	for (const entry of selectionListeners) {
		try {
			entry.listener(selection.map((item) => ({ ...item })));
		} catch (error) {
			logPluginRuntimeError(
				"file explorer listener failed",
				{
					pluginId: entry.pluginId,
					pluginVersion: entry.pluginVersion,
					stage: "selection-change",
				},
				error,
			);
		}
	}
}

export function emitPluginFileExplorerFilesChanged(changes: readonly PluginFileExplorerChange[]): void {
	if (changes.length === 0) return;
	for (const entry of fileChangeListeners) {
		try {
			entry.listener(changes.map((change) => ({ ...change })));
		} catch (error) {
			logPluginRuntimeError(
				"file explorer listener failed",
				{
					pluginId: entry.pluginId,
					pluginVersion: entry.pluginVersion,
					stage: "files-change",
				},
				error,
			);
		}
	}
}
