import type { McpConfig } from "@567agent/runtime-mcp";
import type { McpConfigSource } from "@567agent/runtime-mcp/config";
import { CURRENT_BROWSER_SERVER_NAME, isCurrentBrowserExtension } from "../../shared/current-browser-connection.js";

/** Stateful browser clients belong to a Session; ordinary file-backed MCPs keep workspace pooling. */
export function scopeDesktopMcpConfigSource(source: McpConfigSource, scope: "shared" | "session"): McpConfigSource {
	const select = (config: McpConfig | null): McpConfig | null => {
		if (!config) return null;
		return {
			mcpServers: Object.fromEntries(
				Object.entries(config.mcpServers).filter(([name, server]) => {
					const sessionLocal = name === CURRENT_BROWSER_SERVER_NAME && isCurrentBrowserExtension(server);
					return scope === "session" ? sessionLocal : !sessionLocal;
				}),
			),
		};
	};
	return {
		loadGlobal: () => select(source.loadGlobal()),
		loadProject: () => select(source.loadProject()),
		// Classify after merging so a custom project override retains its original meaning.
		loadMerged: () => select(source.loadMerged()) ?? { mcpServers: {} },
		getMergedSignature: () => `${scope}:${source.getMergedSignature()}`,
		getConfigPaths: () => source.getConfigPaths(),
	};
}
