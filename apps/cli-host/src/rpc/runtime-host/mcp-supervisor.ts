import { CONFIG_DIR_NAME, VERSION } from "@567agent/coding-agent/config";
import { EMPTY_MCP_CONFIG_SOURCE, type McpServerSupervisor } from "@567agent/runtime-mcp";
import { createNodeMcpSupervisor } from "@567agent/runtime-node/mcp";

export interface CliMcpSupervisorOptions {
	readonly projectRoot: string;
	readonly agentDir: string;
	readonly debug: boolean;
	readonly dynamicOnly?: boolean;
}

/** Selects the Node MCP implementation at the CLI Composition Root. */
export function createCliMcpSupervisor(options: CliMcpSupervisorOptions): McpServerSupervisor {
	return createNodeMcpSupervisor({
		projectRoot: options.projectRoot,
		agentDir: options.agentDir,
		clientVersion: VERSION,
		projectConfigDirectoryName: CONFIG_DIR_NAME,
		debug: options.debug,
		enabled: true,
		configSource: options.dynamicOnly ? EMPTY_MCP_CONFIG_SOURCE : undefined,
		includeBuiltinServers: !options.dynamicOnly,
		onDiagnostic: (message) => {
			if (options.debug) console.error(`[MCPManager] ${message}`);
		},
	}).supervisor;
}
