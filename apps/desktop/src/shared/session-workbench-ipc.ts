export const SESSION_WORKBENCH_CHANNELS = {
	WORKBENCH: "agent567:session:workbench",
	WORKBENCH_DETAIL: "agent567:session:workbench-detail",
	ATTACHMENT_READ: "agent567:session:attachment-read",
	REVIEW_CHANGE: "agent567:session:review-change",
	TURN_FILES: "agent567:session:turn-files",
	TURN_FILES_PREVIEW: "agent567:session:turn-files-preview",
	TURN_FILES_RESTORE: "agent567:session:turn-files-restore",
	CONTEXT_WORKSPACE: "agent567:session:context-workspace",
	CONTEXT_SELECTION: "agent567:session:context-selection",
} as const;

export interface TurnFilesSummary {
	readonly turnId: string;
	readonly title: string;
	readonly timestamp: number;
	readonly fileCount: number;
}

export interface TurnFileRestoreEntry {
	readonly path: string;
	readonly change: "added" | "modified" | "deleted" | "unsupported";
	readonly status: "ready" | "conflict" | "unavailable" | "restored";
}

export interface TurnFileRestorePreview {
	readonly previewId: string;
	readonly files: readonly TurnFileRestoreEntry[];
}
