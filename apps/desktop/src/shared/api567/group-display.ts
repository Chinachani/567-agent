/** Backend uses an empty key for its default group; the desktop session stores this historical alias. */
export function groupEntriesForSelection<T>(groups: Record<string, T>): [string, T][] {
	return Object.entries(groups)
		.filter(([name]) => name !== "" || !Object.hasOwn(groups, "默认分组"))
		.map(([name, info]) => [name || "默认分组", info]);
}

export function getProviderIconForGroup(groupName: string): string {
	const lower = groupName.toLowerCase();
	if (lower.includes("claude")) return "claude";
	if (lower.includes("gemini")) return "gemini";
	if (lower.includes("deepseek")) return "deepseek";
	if (lower.includes("grok")) return "grok";
	if (lower.includes("gpt")) return "openai";
	if (lower.includes("国模") || lower.includes("qwen")) return "qwen";
	return "agent567";
}
