import type { AgentBlueprint, AgentProfile } from "@567agent/agent-team";
import { selectAllAgentAbilities } from "./ability-selection";
import type { AgentCapabilityOption } from "./capability-options";

/** Copy values, never provider ownership or a resolved inline avatar URL. */
export function copyExpertDraft(
	source: AgentProfile,
	blueprint: AgentBlueprint | undefined,
	capabilities: readonly AgentCapabilityOption[],
	name: string,
): AgentProfile {
	const abilities =
		source.abilities.selectionMode === "all"
			? { ...selectAllAgentAbilities(capabilities), selectionMode: "custom" as const }
			: structuredClone(source.abilities);
	return {
		id: "",
		revision: 0,
		name,
		description: source.description,
		mentionHandle: "",
		blueprintId: source.blueprintId,
		systemPrompt: source.systemPrompt ?? blueprint?.systemPrompt ?? "",
		...(source.avatar ? { avatar: source.avatar } : {}),
		abilities,
		copiedFrom: source.id,
		scope: { kind: "library" },
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

/** Workflow prose is extracted from the actual prompt, including customized copies. */
export function expertWorkflow(prompt: string, locale: string): readonly string[] {
	const section = prompt.split(/^## Workflow[ \t]*\r?\n/m)[1]?.split(/^## /m)[0] ?? "";
	return [...section.matchAll(/^\d+\.\s+(.+)$/gm)].map((match) => {
		const [english, chinese] = match[1].split(" | ");
		return locale.startsWith("zh") ? (chinese ?? english) : english;
	});
}
