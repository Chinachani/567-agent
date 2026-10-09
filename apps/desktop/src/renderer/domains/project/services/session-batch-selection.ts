import type { SidebarConversationInfo } from "./sidebar-conversation-projection";

export function selectableConversationSessions(
	sessions: readonly SidebarConversationInfo[],
): Extract<SidebarConversationInfo, { kind: "conversation" }>[] {
	return sessions.filter(
		(session): session is Extract<SidebarConversationInfo, { kind: "conversation" }> =>
			session.kind === "conversation",
	);
}

export function toggleSelectedSessionPath(selected: ReadonlySet<string>, path: string): ReadonlySet<string> {
	const next = new Set(selected);
	if (next.has(path)) next.delete(path);
	else next.add(path);
	return next;
}

export function toggleAllSelectedSessionPaths(
	selected: ReadonlySet<string>,
	sessions: readonly SidebarConversationInfo[],
): ReadonlySet<string> {
	const paths = selectableConversationSessions(sessions).map(({ path }) => path);
	if (paths.length > 0 && paths.every((path) => selected.has(path))) return new Set();
	return new Set(paths);
}
