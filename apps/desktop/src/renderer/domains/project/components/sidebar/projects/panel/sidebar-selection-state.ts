export type SidebarSelectionTarget = { kind: "conversation"; path: string } | { kind: "agent-team"; sessionId: string };

interface SidebarSelectionSources {
	currentPath: string;
	activeSessionPath: string;
	pendingSessionPath: string;
	viewerSessionPath: string;
	routeTeamSessionId: string;
}

/** The rendered page owns the final highlight; pending opens are only provisional. */
export function resolveSidebarSelectionState(sources: SidebarSelectionSources): {
	fallbackSelection: SidebarSelectionTarget | null;
	settledSelection: SidebarSelectionTarget | null;
} {
	if (sources.currentPath.startsWith("/agent-teams/")) {
		const selection: SidebarSelectionTarget | null = sources.routeTeamSessionId
			? { kind: "agent-team", sessionId: sources.routeTeamSessionId }
			: null;
		return { fallbackSelection: selection, settledSelection: selection };
	}
	if (sources.pendingSessionPath && sources.currentPath === "/") {
		return {
			fallbackSelection: { kind: "conversation", path: sources.pendingSessionPath },
			settledSelection: null,
		};
	}
	if (sources.viewerSessionPath) {
		const selection: SidebarSelectionTarget = { kind: "conversation", path: sources.viewerSessionPath };
		return { fallbackSelection: selection, settledSelection: selection };
	}
	if (sources.activeSessionPath) {
		const selection: SidebarSelectionTarget = { kind: "conversation", path: sources.activeSessionPath };
		// A session atom can outlive navigation to settings, abilities, projects, or
		// the new-session page. Keep it as the fallback only on the conversation
		// surface so unrelated pages do not retain a stale highlighted row.
		if (sources.currentPath !== "/") return { fallbackSelection: null, settledSelection: null };
		return { fallbackSelection: selection, settledSelection: selection };
	}
	return { fallbackSelection: null, settledSelection: null };
}
