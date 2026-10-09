import type { AgentBlueprint, AgentTeamDocument } from "@567agent/agent-team";
import { i18n } from "@shared/i18n";
import type { BlueprintDisplayPlugin } from "../lib/blueprint-display";
import { type AgentCapabilityOption, buildAgentCapabilityOptions } from "../lib/capability-options";

export interface AgentTeamConfigurationResources {
	readonly document: AgentTeamDocument;
	readonly blueprints: readonly AgentBlueprint[];
	readonly capabilities: readonly AgentCapabilityOption[];
	/** 解析插件贡献的角色名，以及说明档案为什么暂时不可用。 */
	readonly plugins: readonly BlueprintDisplayPlugin[];
}

export async function loadAgentTeamConfigurationResources(): Promise<AgentTeamConfigurationResources> {
	const [document, blueprints, skills, skillManifest, mcpConfig, plugins] = await Promise.all([
		window.agent567.agentTeams.list(),
		window.agent567.agentTeams.listBlueprints(),
		window.agent567.skills.list(),
		window.agent567.skills.getMarketManifest(),
		window.agent567.mcp.get(),
		window.agent567.plugins.listAll(),
	]);
	return {
		document,
		blueprints,
		plugins: plugins as readonly BlueprintDisplayPlugin[],
		capabilities: buildAgentCapabilityOptions({
			skills,
			skillManifest,
			mcpConfig,
			plugins,
			locale: i18n.language,
		}),
	};
}
