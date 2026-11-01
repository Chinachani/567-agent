import { getSharedRuntime } from "../runtime.js";
import { getDesktopConversationService } from "./desktop-conversation-service.js";
import { getDesktopPlanReviewBroker } from "./plan-review-broker.js";
import { getDesktopSandboxAuthorizationBroker } from "./sandbox-authorization-broker.js";
import { resolveDesktopRuntimeSessionRoots } from "./session-catalog-roots.js";
import { getDesktopUserQuestionBroker } from "./user-question-broker.js";
import { VisibleConversationSelection } from "./visible-conversation-selection.js";

export const visibleConversation = new VisibleConversationSelection(
	getSharedRuntime,
	async (path) => {
		for (const root of resolveDesktopRuntimeSessionRoots()) {
			const sessions = await getDesktopConversationService()
				.listSessions(root.cwd, root.sessionDir)
				.catch(() => []);
			const session = sessions.find((item) => item.path === path);
			if (session)
				return { id: session.id, title: (session.name?.trim() || session.firstMessage || "").slice(0, 300) };
		}
		return null;
	},
	(runtimeId) =>
		getDesktopUserQuestionBroker()
			.listPendingQuestions()
			.some((item) => item.sessionId === runtimeId) ||
		getDesktopSandboxAuthorizationBroker().hasPending(runtimeId) ||
		getDesktopPlanReviewBroker()
			.listPending()
			.some((item) => item.sessionId === runtimeId),
);
