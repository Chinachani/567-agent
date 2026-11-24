export const SESSION_DRAFT_CHANNELS = {
	LIST: "agent567:session-drafts:list",
	SAVE: "agent567:session-drafts:save",
	DELETE: "agent567:session-drafts:delete",
	REKEY: "agent567:session-drafts:rekey",
	APPENDED: "agent567:session-drafts:appended",
} as const;

export interface PersistedSessionDraftRecord {
	readonly text: string;
	readonly updatedAt: number;
	readonly revision: number;
}

export type PersistedSessionDraftMap = Record<string, PersistedSessionDraftRecord>;

export interface SessionDraftAppendedEvent {
	readonly key: string;
	readonly appendText: string;
	readonly idempotencyKey: string;
	readonly baseText: string;
	readonly nextText: string;
	readonly targetType: "new" | "existing";
	readonly revision: number;
	readonly sessionTitle?: string;
}

export interface DesktopSessionDraftsApi {
	list(): Promise<PersistedSessionDraftMap>;
	save(key: string, text: string, expectedRevision?: number): Promise<void>;
	remove(key: string, expectedRevision?: number): Promise<void>;
	rekey(fromKey: string, toKey: string, expectedRevision?: number): Promise<number | null>;
	onAppended(listener: (event: SessionDraftAppendedEvent) => void): () => void;
}
