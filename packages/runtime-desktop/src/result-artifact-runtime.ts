import { join } from "node:path";
import { createCodingAgentCodingToolResultPolicy } from "@567agent/coding-agent/composition";
import { createMcpToolResultPolicy, type McpToolResultPolicy } from "@567agent/runtime-mcp";
import { createNodeResultArtifactStorage, type NodeSessionArtifactStore } from "@567agent/runtime-node/host";
import type { CodingToolResultPolicy } from "@567agent/runtime-tools";

export interface DesktopResultArtifactRuntime {
	readonly codingToolResultPolicy: CodingToolResultPolicy;
	readonly mcpToolResultPolicy: McpToolResultPolicy;
	readonly sessionArtifactCleaner: NodeSessionArtifactStore;
}

export function createDesktopResultArtifactRuntime(agentDir: string): DesktopResultArtifactRuntime {
	const storage = createNodeResultArtifactStorage({
		codingRoot: join(agentDir, "tool-results"),
		mcpRoot: join(agentDir, "mcp-results"),
	});
	return {
		codingToolResultPolicy: createCodingAgentCodingToolResultPolicy({ artifactStore: storage.coding }),
		mcpToolResultPolicy: createMcpToolResultPolicy({ artifactStore: storage.mcp }),
		sessionArtifactCleaner: storage.cleaner,
	};
}
