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
	readonly executionCwd?: string;
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
export type ManagedWorktreeErrorCode =
	| "unsupported-remote"
	| "git-unavailable"
	| "not-repository"
	| "invalid-start-ref"
	| "start-ref-missing-subdir"
	| "limit-reached"
	| "git-failed"
	| "not-managed"
	| "worktree-dirty"
	| "worktree-in-use";
export interface ManagedWorktreeRecord {
	readonly path: string;
	readonly cwd: string;
	readonly sessionId: string;
	readonly sessionPath: string;
	readonly baseCommit: string;
}
export interface ManagedWorktreeInfo extends ManagedWorktreeRecord {
	readonly state: "ok" | "missing";
	readonly dirty: boolean | null;
	readonly inUse: boolean;
}
export interface ProjectCollaborationWorktreesState {
	readonly supported: boolean;
	readonly worktrees: readonly ManagedWorktreeInfo[];
}
export type ManagedWorktreeActionResult =
	| {
			readonly ok: true;
			readonly snapshot: ProjectCollaborationWorktreesState;
	  }
	| {
			readonly ok: false;
			readonly error: {
				readonly code: ManagedWorktreeErrorCode;
				readonly changedPreview?: readonly string[];
			};
	  };
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
	readonly worktrees?: readonly ManagedWorktreeRecord[];
}
export interface ProjectCollaborationControl {
	readonly action: "pause" | "resume" | "stop" | "continue";
	readonly taskId?: string;
}
export const PROJECT_COLLABORATION_CHANNELS = {
	read: "agent567:project-collaboration:read",
	update: "agent567:project-collaboration:update",
	control: "agent567:project-collaboration:control",
	readWorktrees: "agent567:project-collaboration:read-worktrees",
	createWorktree: "agent567:project-collaboration:create-worktree",
	removeWorktree: "agent567:project-collaboration:remove-worktree",
	changed: "agent567:project-collaboration:changed",
} as const;
