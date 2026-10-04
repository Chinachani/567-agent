/** Build a stable, single path segment for the session-owned canvas directory. */
export function getSessionCanvasDir(projectDir: string, sessionPath: string): string {
	const normalizedSessionPath = sessionPath.trim();
	const sessionFile = normalizedSessionPath.endsWith("/") || normalizedSessionPath.endsWith("\\")
		? undefined
		: normalizedSessionPath.split(/[\\/]/).filter(Boolean).at(-1);
	if (!sessionFile) throw new Error("Cannot create a session canvas without a session path");

	const sessionId = sessionFile.replace(/\.jsonl$/i, "");
	const safeSessionId = encodeURIComponent(sessionId).replaceAll(".", "%2E");
	const sep = projectDir.includes("\\") && !projectDir.includes("/") ? "\\" : "/";
	return `${projectDir.replace(/[/\\]+$/, "")}${sep}canvas${sep}sessions${sep}${safeSessionId}`;
}
