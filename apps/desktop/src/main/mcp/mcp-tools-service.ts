import { join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { MCP_DEFAULT_PROTOCOL_VERSION, type McpClientHandle, type McpServerConfig } from "@567agent/runtime-mcp";
import {
	createMcpClient,
	FileMcpConfigSource,
	FileMcpOAuthStateStore,
	McpOAuthProvider,
} from "@567agent/runtime-node/mcp";
import type { McpAvailableTool } from "../../preload/api-types/mcp.js";
import { ensureOpenMarketplaceManagedMcpRuntime } from "../abilities/open-marketplace/open-marketplace-mcp-runtime-host.js";
import { DEFAULT_CONVERSATION_CWD } from "../config/desktop-config-store.js";
import { mainT } from "../i18n/index.js";
import { readMcpConfig } from "./mcp-settings-service.js";

export interface McpToolsServiceOptions {
	readonly loadServer: (name: string) => Promise<McpServerConfig | undefined>;
	readonly createClient: (name: string, config: McpServerConfig) => McpClientHandle;
}

/** Short-lived discovery connections never call tools or change enabled state. */
export class McpToolsService {
	private readonly pending = new Map<string, Promise<McpAvailableTool[]>>();
	constructor(private readonly options: McpToolsServiceOptions) {}

	list(name: string): Promise<McpAvailableTool[]> {
		const existing = this.pending.get(name);
		if (existing) return existing;
		const operation = this.discover(name).finally(() => this.pending.delete(name));
		this.pending.set(name, operation);
		return operation;
	}

	private async discover(name: string): Promise<McpAvailableTool[]> {
		const config = await this.options.loadServer(name);
		if (!config) throw new Error(mainT("mcpPreview.notFound"));
		if (config.disabled) throw new Error(mainT("mcpPreview.disabled"));
		const client = this.options.createClient(name, config);
		try {
			const initialized = await client.initialize({
				protocolVersion: MCP_DEFAULT_PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "567-agent-tools-preview", version: "1.0.0" },
			});
			if (!initialized.capabilities?.tools) return [];
			const tools = new Map<string, McpAvailableTool>();
			const cursors = new Set<string>();
			let cursor: string | undefined;
			let pages = 0;
			const deadline = Date.now() + 30_000;
			do {
				if (++pages > 32 || Date.now() > deadline) throw new Error(mainT("mcpPreview.limitExceeded"));
				const page = await client.listTools(cursor);
				if (tools.size + page.tools.length > 2000) throw new Error(mainT("mcpPreview.limitExceeded"));
				for (const tool of page.tools) tools.set(tool.name, { name: tool.name, description: tool.description });
				cursor = page.nextCursor;
				if (cursor && cursors.has(cursor)) throw new Error(mainT("mcpPreview.paginationFailed"));
				if (cursor) cursors.add(cursor);
			} while (cursor);
			return [...tools.values()];
		} finally {
			await client.close();
		}
	}
}

let service: McpToolsService | undefined;
export function getDesktopMcpToolsService(): McpToolsService {
	const agentDir = join(getAgent567HomePath(), "agent");
	service ??= new McpToolsService({
		loadServer: async (name) => {
			await readMcpConfig();
			const source = new FileMcpConfigSource({
				globalConfigPath: join(agentDir, "mcp.json"),
				projectConfigPath: "",
				projectRoot: DEFAULT_CONVERSATION_CWD,
				includeServer: (entry) => entry.name === name,
			});
			return source.loadMerged().mcpServers[name];
		},
		createClient: (name, config) => {
			const store = new FileMcpOAuthStateStore({ authDirectory: join(agentDir, "mcp-auth") });
			const runtimeId =
				"managedRuntimeId" in config && typeof config.managedRuntimeId === "string"
					? config.managedRuntimeId
					: undefined;
			const resolved =
				config.type === "http" && runtimeId
					? {
							...config,
							resolveUrl: () => ensureOpenMarketplaceManagedMcpRuntime(runtimeId, config.managedRuntimeEnv),
						}
					: config;
			return createMcpClient(name, resolved, {
				timeout: config.startupTimeout ?? 10_000,
				httpAuthProviderFactory: ({ serverName, serverUrl, config: httpConfig }) =>
					store.hasTokens(serverName)
						? new McpOAuthProvider({
								serverName,
								serverUrl,
								redirectUri: store.load(serverName)?.redirectUri ?? "http://127.0.0.1/callback",
								onRedirect: () => undefined,
								store,
								clientName: "567 Agent",
								clientId: httpConfig.oauthClientId,
							})
						: undefined,
			});
		},
	});
	return service;
}
