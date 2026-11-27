import type { Project, SessionInfo } from "@shared/store/atoms";
import { resolveDesktopSessionOpenTarget } from "@/shared/session-access";
import { COMMAND_MENU_GROUP_LIMIT, type CommandMenuSession } from "../types";

export function listCachedRecentSessions(
	projects: readonly Project[],
	imCwd: string,
	sessionsByCwd: ReadonlyMap<string, readonly SessionInfo[]>,
): CommandMenuSession[] {
	const sources = new Map<string, Pick<CommandMenuSession, "sourceKind" | "sourceName">>();
	for (const project of projects) {
		if (project.type === "batch") continue;
		sources.set(project.cwd, {
			sourceKind: project.isDefault ? "conversation" : "project",
			sourceName: project.isDefault ? undefined : project.name,
		});
	}
	if (imCwd) sources.set(imCwd, { sourceKind: "claw" });

	const recentByPath = new Map<string, CommandMenuSession>();
	for (const [sourceCwd, source] of sources) {
		for (const session of sessionsByCwd.get(sourceCwd) ?? []) {
			const { access } = session;
			if (!access || resolveDesktopSessionOpenTarget(access) === "unavailable") continue;
			const previous = recentByPath.get(session.path);
			if (!previous || session.modifiedAt > previous.session.modifiedAt) {
				recentByPath.set(session.path, { ...source, sourceCwd, session: { ...session, access } });
			}
		}
	}
	return [...recentByPath.values()]
		.sort((left, right) => right.session.modifiedAt - left.session.modifiedAt)
		.slice(0, COMMAND_MENU_GROUP_LIMIT);
}
