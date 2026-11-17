import { getDesktopConversationService } from "../conversations/desktop-conversation-service.js";
import { samePath } from "../conversations/session-paths.js";

/** Only a resumable, user-owned session in the selected project may be bound. */
export async function assertAutomationSessionTarget(projectCwd: string, sessionPath: string): Promise<void> {
	const sessions = await getDesktopConversationService().listSessions(projectCwd);
	if (!sessions.some((session) => samePath(session.path, sessionPath) && session.access.resume)) {
		throw new Error("Automation session is missing, unavailable, or outside the selected project");
	}
}
