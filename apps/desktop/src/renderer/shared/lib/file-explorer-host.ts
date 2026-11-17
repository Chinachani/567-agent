import type {
	Disposable,
	PluginFileExplorerEntry,
	PluginFileExplorerRevealOptions,
	PluginWorkspaceRoot,
} from "@vetta-org/plugin-sdk";

export interface FileExplorerHostAdapter {
	getWorkspaceRoot(): PluginWorkspaceRoot | null;
	getSelection(): readonly PluginFileExplorerEntry[];
	reveal(path: string, options?: PluginFileExplorerRevealOptions): Promise<void>;
	refresh(path?: string): Promise<void>;
}

let activeAdapter: FileExplorerHostAdapter | null = null;

export function bindFileExplorerHost(adapter: FileExplorerHostAdapter): Disposable {
	activeAdapter = adapter;
	return {
		dispose: () => {
			if (activeAdapter === adapter) activeAdapter = null;
		},
	};
}

export function getFileExplorerWorkspaceRoots(): readonly PluginWorkspaceRoot[] {
	const root = activeAdapter?.getWorkspaceRoot() ?? null;
	return root ? [{ ...root }] : [];
}

export function getFileExplorerSelection(): readonly PluginFileExplorerEntry[] {
	return (activeAdapter?.getSelection() ?? []).map((entry) => ({ ...entry }));
}

export async function revealFileExplorerPath(path: string, options?: PluginFileExplorerRevealOptions): Promise<void> {
	if (!activeAdapter) throw new Error("File explorer is not available");
	await activeAdapter.reveal(path, options);
}

export async function refreshFileExplorer(path?: string): Promise<void> {
	if (!activeAdapter) throw new Error("File explorer is not available");
	await activeAdapter.refresh(path);
}
