import type { ChatConversationItem } from "@shared/store/atoms";

export interface SharedChatMessageSnapshot {
	messages: ChatConversationItem[];
	reusedCount: number;
}

/**
 * Reconcile two independently mapped views of the same persisted history.
 *
 * Viewer preview and Runtime hydration intentionally use separate I/O paths, so
 * they cannot share object identity on their own.  This hydration-boundary
 * comparison preserves the preview objects for messages whose serialized
 * contract is unchanged. React.memo can then retain already-painted rows while
 * still replacing any message that Runtime canonicalization actually changed.
 *
 * ChatConversationItem is a JSON-compatible renderer DTO. Keep this comparison out of
 * render paths: it is only meant for the one-off preview -> canonical handoff.
 */
export function shareChatMessageSnapshot(
	preview: readonly ChatConversationItem[],
	canonical: readonly ChatConversationItem[],
): SharedChatMessageSnapshot {
	if (preview === canonical) {
		return { messages: preview as ChatConversationItem[], reusedCount: preview.length };
	}
	if (preview.length === 0 || canonical.length === 0) {
		return { messages: canonical as ChatConversationItem[], reusedCount: 0 };
	}

	const previewById = new Map(preview.map((message) => [message.id, message]));
	let reusedCount = 0;
	const messages = canonical.map((message) => {
		const candidate = previewById.get(message.id);
		if (candidate === undefined || JSON.stringify(candidate) !== JSON.stringify(message)) {
			return message;
		}
		reusedCount += 1;
		return candidate;
	});

	if (
		reusedCount === preview.length &&
		reusedCount === canonical.length &&
		messages.every((message, index) => message === preview[index])
	) {
		return { messages: preview as ChatConversationItem[], reusedCount };
	}
	return { messages, reusedCount };
}

/**
 * Keeps renderer-only rows accepted after a Viewer snapshot was committed while
 * replacing that persisted base with Runtime-canonical history.
 */
export function preserveMessagesAddedAfterSnapshot(
	preview: readonly ChatConversationItem[],
	canonical: readonly ChatConversationItem[],
	current: readonly ChatConversationItem[],
): ChatConversationItem[] {
	const previewIds = new Set(preview.map((message) => message.id));
	const canonicalIds = new Set(canonical.map((message) => message.id));
	const currentIds = new Set(current.map((message) => message.id));
	const canonicalIsPreviewPrefix =
		canonical.length < preview.length &&
		canonical.every((message, index) =>
			message.entryId ? message.entryId === preview[index]?.entryId : message.id === preview[index]?.id,
		);
	const retainedPreview = canonicalIsPreviewPrefix
		? preview.slice(canonical.length).filter((message) => currentIds.has(message.id))
		: [];
	const canonicalUsers = canonical.filter((message) => message.kind === "user");
	const lastPreviewUser = [...preview].reverse().find((message) => message.kind === "user" && message.entryId);
	const anchor = lastPreviewUser
		? canonicalUsers.findIndex((message) => message.entryId === lastPreviewUser.entryId)
		: preview.length === 0
			? -1
			: undefined;
	let nextUserIndex = anchor === undefined || (anchor < 0 && preview.length > 0) ? undefined : anchor + 1;
	const additions = current.filter((message) => {
		if (previewIds.has(message.id) || canonicalIds.has(message.id)) return false;
		if (message.kind !== "user" || nextUserIndex === undefined) return true;
		const corresponding = canonicalUsers[nextUserIndex++];
		if (!corresponding || corresponding.text !== message.text) return true;
		if (corresponding.settingsAssistTabId !== message.settingsAssistTabId) return true;
		if (
			corresponding.promptRef?.kind !== message.promptRef?.kind ||
			corresponding.promptRef?.name !== message.promptRef?.name
		)
			return true;
		const actual = corresponding.attachments ?? [];
		const expected = message.attachments ?? [];
		return (
			actual.length !== expected.length ||
			actual.some((item, index) => item.kind !== expected[index]?.kind || item.path !== expected[index]?.path)
		);
	});
	return retainedPreview.length === 0 && additions.length === 0
		? (canonical as ChatConversationItem[])
		: [...canonical, ...retainedPreview, ...additions];
}
