import { useMemo } from "react";
import { type AgentLibraryCopy, useAgentLibraryModel } from "./useAgentLibraryModel";
import { useAgentTeamResources } from "./useAgentTeamResources";

/** Experts use ordinary sessions; legacy definitions remain available for history. */
export function useAgentCenterModel(copy: AgentLibraryCopy) {
	const resources = useAgentTeamResources();
	const library = useAgentLibraryModel(resources, copy);
	const agentsById = useMemo(
		() => new Map(resources.document?.agents.map((agent) => [agent.id, agent]) ?? []),
		[resources.document],
	);
	return {
		...resources,
		agents: library.libraryAgents,
		agentsById,
		teams: resources.document?.teams ?? [],
		findAgent: (id: string) => agentsById.get(id),
		findTeam: (id: string) => resources.document?.teams.find((team) => team.id === id),
		actions: { ...library.actions, createAgentFromDraft: library.actions.createAgent },
	};
}

export type AgentCenterModel = ReturnType<typeof useAgentCenterModel>;
