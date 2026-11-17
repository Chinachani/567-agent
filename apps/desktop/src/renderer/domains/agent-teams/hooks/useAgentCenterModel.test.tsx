// @vitest-environment jsdom

import type { AgentTeamDocument, TeamDefinition } from "@567agent/agent-team";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAgentCenterModel } from "./useAgentCenterModel";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("../services/load-agent-team-resources", () => ({
	loadAgentTeamConfigurationResources: mocks.load,
}));

const leader = {
	id: "designer",
	revision: 1,
	name: "设计师",
	description: "",
	mentionHandle: "designer",
	blueprintId: "plugin:vetta-ui-design:designer",
	abilities: { selectionMode: "all", skills: [], mcpServers: [], plugins: [] },
	scope: { kind: "library" },
	createdAt: 1,
	updatedAt: 1,
} as const;

function team(id: string, source?: TeamDefinition["source"]): TeamDefinition {
	return {
		id,
		revision: 1,
		name: id,
		description: "",
		leaderMemberId: `${id}:leader`,
		members: [{ id: `${id}:leader`, handle: "designer", binding: { kind: "reference", agentProfileId: leader.id } }],
		orchestrationPolicyId: "leader-delegates-v1",
		contextPolicyId: "public-results-v1",
		...(source ? { source } : {}),
		createdAt: 1,
		updatedAt: 1,
	};
}

describe("useAgentCenterModel", () => {
	it("retains legacy teams for history while exposing only library experts", async () => {
		const pluginTeam = team("design-team", { kind: "plugin", pluginId: "vetta-ui-design" });
		const userTeam = team("my-team");
		const document = { schemaVersion: 1, revision: 1, agents: [leader], teams: [pluginTeam, userTeam] };
		mocks.load.mockResolvedValue({
			document: document as unknown as AgentTeamDocument,
			blueprints: [],
			plugins: [],
			capabilities: [],
		});
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { agentTeams: { list: vi.fn(), onChanged: () => () => {} } },
		});

		const { result } = renderHook(() => useAgentCenterModel({ defaultName: "", defaultDescription: "" }));
		await waitFor(() => expect(result.current.teams).toHaveLength(2));

		expect(result.current.findTeam(pluginTeam.id)).toEqual(pluginTeam);
		expect(result.current.findTeam(userTeam.id)).toEqual(userTeam);
		expect(result.current.agents).toEqual([leader]);
		expect(result.current.findAgent(leader.id)).toEqual(leader);
		expect(result.current.actions).not.toHaveProperty("startEditTeam");
	});
});
