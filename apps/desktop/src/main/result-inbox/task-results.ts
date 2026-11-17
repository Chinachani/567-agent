import {
	type ConversationDocument,
	nativeConversationEntryId,
	selectConversationDocumentEntries,
} from "@567agent/runtime-core/conversation";
import type { StoredConversation, StoredSessionEvent } from "@567agent/runtime-core/kernel";
import type { TaskResult } from "../../shared/result-inbox.js";

type Attempt = { id: string; startedAt: number; terminal?: StoredSessionEvent };

/** The journal owns outcomes; the active document branch owns which user requests still exist. */
export function projectTaskResults(conversation: StoredConversation, document: ConversationDocument): TaskResult[] {
	const branch = selectConversationDocumentEntries(document);
	const branchIds = new Set(branch.map((entry) => entry.id));
	const visibleUsers = new Set(
		conversation.events.flatMap((event, index) =>
			event.type === "message.appended" &&
			event.message.role === "user" &&
			branchIds.has(nativeConversationEntryId(index + 1))
				? [event.turnId]
				: [],
		),
	);
	for (const entry of branch) if (entry.type === "message" && entry.kind === "user") visibleUsers.add(entry.turnId);
	// A continuation seed has no old event journal. The continued turn retains its identity.
	if (
		branch.some(
			(entry) =>
				entry.type === "message" &&
				typeof entry.message === "object" &&
				entry.message !== null &&
				"role" in entry.message &&
				entry.message.role === "user",
		)
	) {
		const continued = conversation.events.find((event) => event.type === "turn.continued");
		if (continued) visibleUsers.add(continued.turnId);
	}
	const attempts = new Map<string, Attempt>();
	const groups: { taskId: string; attempts: Attempt[] }[] = [];
	const userTurns = new Set(
		conversation.events
			.filter((e) => e.type === "message.appended" && e.message.role === "user")
			.map((e) => e.turnId),
	);
	for (const event of conversation.events) {
		if (!event.turnId) continue;
		if (event.type === "turn.started" || event.type === "turn.continued") {
			const attempt: Attempt = { id: event.turnId, startedAt: event.timestamp };
			attempts.set(event.turnId, attempt);
			if (userTurns.has(event.turnId)) groups.push({ taskId: event.turnId, attempts: [] });
			// Continuation files can carry their original request in the document seed.
			if (groups.length === 0 && event.type === "turn.continued") {
				const seedUser = [...visibleUsers].at(-1);
				if (seedUser) groups.push({ taskId: seedUser, attempts: [] });
			}
			groups.at(-1)?.attempts.push(attempt);
		} else if (["turn.completed", "turn.failed", "turn.cancelled", "turn.transferred"].includes(event.type)) {
			const attempt = attempts.get(event.turnId);
			if (attempt) attempt.terminal = event;
		}
	}
	return groups.flatMap((group): TaskResult[] => {
		if (!visibleUsers.has(group.taskId)) return [];
		const latest = group.attempts.at(-1);
		const first = group.attempts[0];
		if (!latest || !first || latest.terminal?.type === "turn.transferred") return [];
		const terminal = latest.terminal;
		const status =
			terminal?.type === "turn.completed"
				? "completed"
				: terminal?.type === "turn.failed"
					? "failed"
					: terminal?.type === "turn.cancelled"
						? "cancelled"
						: "unknown";
		return [
			{
				sessionId: conversation.sessionId,
				taskId: group.taskId,
				title: "",
				startedAt: first.startedAt,
				...(terminal ? { endedAt: terminal.timestamp } : {}),
				status,
				open: !terminal,
			},
		];
	});
}
