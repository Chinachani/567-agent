import { type AgentProfile, pluginBlueprintId } from "@567agent/agent-team";

export const EXPERT_CATEGORIES = [
	"planning",
	"development",
	"research",
	"review",
	"solutions",
	"writing",
	"learning",
	"work",
	"everyday",
	"custom",
	"extensions",
] as const;
export type ExpertCategory = (typeof EXPERT_CATEGORIES)[number];

const BUILTIN_CATEGORIES = new Map<string, ExpertCategory>([
	[pluginBlueprintId("preset-agent", "master"), "planning"],
	[pluginBlueprintId("preset-agent", "developer"), "development"],
	[pluginBlueprintId("preset-agent", "researcher"), "research"],
	[pluginBlueprintId("preset-agent", "auditor"), "review"],
	[pluginBlueprintId("preset-agent", "business"), "solutions"],
	["master", "planning"],
	["leader", "planning"],
	["executor", "development"],
	["builder", "development"],
	["researcher", "research"],
	["auditor", "review"],
	["reviewer", "review"],
	["business", "solutions"],
	[pluginBlueprintId("everyday-experts", "message-helper"), "writing"],
	[pluginBlueprintId("everyday-experts", "notes-to-actions"), "work"],
	[pluginBlueprintId("everyday-experts", "buying-comparison"), "everyday"],
	[pluginBlueprintId("everyday-experts", "trip-planner"), "everyday"],
	[pluginBlueprintId("everyday-experts", "meal-planner"), "everyday"],
	[pluginBlueprintId("everyday-experts", "learning-coach"), "learning"],
	[pluginBlueprintId("everyday-experts", "money-splitter"), "everyday"],
	[pluginBlueprintId("everyday-experts", "paperwork-helper"), "work"],
	[pluginBlueprintId("everyday-experts", "home-repair-triage"), "everyday"],
	[pluginBlueprintId("everyday-experts", "event-planner"), "planning"],
	[pluginBlueprintId("everyday-experts", "gift-planner"), "everyday"],
	[pluginBlueprintId("everyday-experts", "job-application-coach"), "work"],
	[pluginBlueprintId("everyday-experts", "interview-practice"), "work"],
	[pluginBlueprintId("everyday-experts", "language-practice"), "learning"],
	[pluginBlueprintId("everyday-experts", "declutter-helper"), "everyday"],
	[pluginBlueprintId("everyday-experts", "move-planner"), "planning"],
	[pluginBlueprintId("everyday-experts", "device-helper"), "everyday"],
	[pluginBlueprintId("everyday-experts", "family-week-planner"), "planning"],
]);

/** Only known stable identities imply a specialty; names and prompt prose do not. */
export function expertCategory(agent: AgentProfile): ExpertCategory {
	return BUILTIN_CATEGORIES.get(agent.blueprintId) ?? (agent.source ? "extensions" : "custom");
}
