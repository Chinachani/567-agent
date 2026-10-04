import { ABILITY_CATEGORY_UNCATEGORIZED, ABILITY_CATEGORY_VETTA_BUILTIN, type AbilityItem } from "../types";

// Merge only documented aliases. Two unrelated categories sharing a translation keep their identities.
const CATEGORY_ALIASES: Readonly<Record<string, string>> = {
	database: "data-databases",
	databases: "data-databases",
	"data-databases": "data-databases",
	development: "developer-tools",
	"developer-tools": "developer-tools",
	system: "system-tools",
	"system-tools": "system-tools",
	web: "web-search",
	"web-search": "web-search",
	knowledge: "knowledge-memory",
	"knowledge-memory": "knowledge-memory",
	ai: "ai-agents",
	"ai-agents": "ai-agents",
	productivity: "productivity",
	automation: "automation",
	communication: "communication",
	"creative-media": "creative-media",
	"cad-3d": "cad-3d",
	uncategorized: ABILITY_CATEGORY_UNCATEGORIZED,
};
export function normalizeAbilityCategory(category: string): string {
	const trimmed = category.trim();
	return CATEGORY_ALIASES[trimmed.toLowerCase()] ?? (trimmed || ABILITY_CATEGORY_UNCATEGORIZED);
}
export function abilityCategoryKey(item: AbilityItem): string {
	return item.isBuiltin ? ABILITY_CATEGORY_VETTA_BUILTIN : normalizeAbilityCategory(item.category);
}
