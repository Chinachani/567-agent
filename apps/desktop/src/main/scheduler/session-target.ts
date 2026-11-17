import { samePath } from "../conversations/session-paths.js";

/** Only a resumable, user-owned session in the selected project may be bound. */
export async function assertAutomationSessionTarget(projectCwd: string, sessionPath: string): Promise<void> {
	// Ordinary task listing/editing does not need the conversation runtime or GUI.
	const { getDesktopConversationService } = await import("../conversations/desktop-conversation-service.js");
	const sessions = await getDesktopConversationService().listSessions(projectCwd);
	if (!sessions.some((session) => samePath(session.path, sessionPath) && session.access.resume)) {
		throw new Error("Automation session is missing, unavailable, or outside the selected project");
	}
}
