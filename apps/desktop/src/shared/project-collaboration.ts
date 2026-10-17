export type CollaborationAccess = "read" | "write";
export interface ProjectCollaborationMember {
	readonly sessionId: string;
	readonly responsibility: string;
	readonly access: CollaborationAccess;
}
export interface ProjectCollaborationConfig {
	readonly schemaVersion: 1;
	readonly revision: number;
	readonly enabled: boolean;
	readonly paused: boolean;
	readonly coordinatorSessionId: string | null;
	readonly members: readonly ProjectCollaborationMember[];
}
export interface ProjectCollaborationPatch {
	readonly revision: number;
	readonly enabled?: boolean;
	readonly paused?: boolean;
	readonly coordinatorSessionId?: string | null;
	readonly members?: readonly ProjectCollaborationMember[];
}
export type CollaborationTaskStatus =
	| "queued"
	| "running"
	| "waiting"
	| "completed"
	| "failed"
	| "interrupted"
	| "cancelled"
	| "attention";
export interface ProjectCollaborationTask {
	readonly id: string;
	readonly rootId: string;
	readonly parentId?: string;
	readonly requestKey: string;
	readonly sourceSessionId: string;
	readonly targetSessionId: string;
	readonly kind: "task" | "question" | "notice" | "result";
	readonly stage?: "work" | "review" | "fix";
	readonly access: CollaborationAccess;
	readonly objective: string;
	readonly status: CollaborationTaskStatus;
	readonly createdAt: number;
	readonly startedAt?: number;
	readonly finishedAt?: number;
	readonly result?: string;
	readonly error?: string;
	readonly reviewRound: number;
	/** Explicit human continuation asks to inspect existing work before proceeding; never replay automatically. */
	readonly resume?: boolean;
	readonly deliveredToSource?: boolean;
	readonly resultVersion?: number;
}
export interface ProjectCollaborationCandidate {
	readonly sessionId: string;
	readonly path: string;
	readonly title: string;
	readonly preview: string;
	readonly modifiedAt: number;
	readonly model: string | null;
	readonly state: "idle" | "running" | "unavailable";
}
export interface ProjectCollaborationSnapshot {
	readonly cwd: string;
	readonly config: ProjectCollaborationConfig;
	readonly candidates: readonly ProjectCollaborationCandidate[];
	readonly tasks: readonly ProjectCollaborationTask[];
}
export interface ProjectCollaborationDocument {
	readonly schemaVersion: 1;
	readonly config: ProjectCollaborationConfig;
	readonly tasks: readonly ProjectCollaborationTask[];
}
export interface ProjectCollaborationControl {
	readonly action: "pause" | "resume" | "stop" | "continue";
	readonly taskId?: string;
}
export const PROJECT_COLLABORATION_CHANNELS = {
	read: "agent567:project-collaboration:read",
	update: "agent567:project-collaboration:update",
	control: "agent567:project-collaboration:control",
	changed: "agent567:project-collaboration:changed",
} as const;
