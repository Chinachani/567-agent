/** The official host bridge deliberately exposes development state as unknown. */
export function readDevWatchState(value: unknown): VettaPluginDevWatchState | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (
		typeof record.projectDir !== "string" ||
		!record.projectDir ||
		(record.status !== "starting" && record.status !== "running" && record.status !== "error")
	)
		return null;
	return {
		projectDir: record.projectDir,
		status: record.status,
		...(typeof record.entryUrl === "string" ? { entryUrl: record.entryUrl } : {}),
		...(typeof record.origin === "string" ? { origin: record.origin } : {}),
		...(typeof record.error === "string" ? { error: record.error } : {}),
	};
}
