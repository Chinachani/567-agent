/** Backend uses an empty key for its default group; the desktop session stores this historical alias. */
export function groupEntriesForSelection<T>(groups: Record<string, T>, primaryGroup?: string): [string, T][] {
	const entries = Object.entries(groups)
		.filter(([name]) => name !== "" || !Object.hasOwn(groups, "默认分组"))
		.map(([name, info]) => [name || "默认分组", info] as [string, T]);
	const normalizedPrimary = primaryGroup || "默认分组";
	const primaryIndex = entries.findIndex(([name]) => name === normalizedPrimary);
	if (primaryIndex <= 0) return entries;
	const [primary] = entries.splice(primaryIndex, 1);
	if (primary) entries.unshift(primary);
	return entries;
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
