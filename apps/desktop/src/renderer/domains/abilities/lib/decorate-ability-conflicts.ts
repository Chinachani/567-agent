import type { AbilityItem } from "../types";

function normalizedName(item: AbilityItem): string {
	return item.title.trim().toLocaleLowerCase();
}

/**
 * 通用 Agent Skill 目录（`~/.agents/skills`、`<cwd>/.agents/skills`）不受 567 Agent 托管，
 * 其同名条目按 ADR-0020 一律让位于 567 Agent 原生 skill，因此不占安装位、不判冲突。
 */
function occupiesInstallSlot(item: AbilityItem): boolean {
	if (item.type !== "skill" && item.type !== "scene") return true;
	return !item.skillSource?.startsWith("agents-");
}

function appendToGroup(groups: Map<string, AbilityItem[]>, key: string, item: AbilityItem): void {
	const group = groups.get(key);
	if (group) group.push(item);
	else groups.set(key, [item]);
}

export function decorateAbilityConflicts(items: AbilityItem[]): AbilityItem[] {
	const sameNameGroups = new Map<string, AbilityItem[]>();
	const physicalGroups = new Map<string, AbilityItem[]>();

	for (const item of items) {
		const name = normalizedName(item);
		if (name) appendToGroup(sameNameGroups, `${item.type}:${name}`, item);
		if (item.type !== "mcp" && item.type !== "bundle") {
			appendToGroup(physicalGroups, `${item.type}:${item.slug}`, item);
		}
	}

	const sameNameIds = new Map<string, string[]>();
	const sameNameCounts = new Map<string, number>();
	for (const group of sameNameGroups.values()) {
		if (group.length < 2) continue;
		const preview = group.slice(0, 33);
		for (const item of group) {
			sameNameCounts.set(item.id, group.length - 1);
			sameNameIds.set(
				item.id,
				preview
					.filter((candidate) => candidate.id !== item.id)
					.slice(0, 32)
					.map((candidate) => candidate.id),
			);
		}
	}

	const installConflictIds = new Map<string, string[]>();
	for (const group of physicalGroups.values()) {
		const installed = group.filter((item) => item.installed && occupiesInstallSlot(item));
		if (installed.length === 0) continue;
		for (const item of group) {
			if (item.installed) continue;
			installConflictIds.set(
				item.id,
				installed.map((candidate) => candidate.id),
			);
		}
	}

	return items.map((item) => ({
		...item,
		...(sameNameIds.has(item.id)
			? { sameNameIds: sameNameIds.get(item.id), sameNameCount: sameNameCounts.get(item.id) }
			: {}),
		...(installConflictIds.has(item.id) ? { installConflictIds: installConflictIds.get(item.id) } : {}),
	}));
}
