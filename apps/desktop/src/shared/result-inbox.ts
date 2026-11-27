import type { DesktopSessionOpenTarget } from "./session-access.js";

export type TaskResultStatus = "completed" | "failed" | "cancelled" | "running" | "unknown";

export interface TaskResult {
	readonly sessionId: string;
	readonly taskId: string;
	readonly title: string;
	readonly startedAt: number;
	readonly endedAt?: number;
	readonly status: TaskResultStatus;
	readonly open: boolean;
}

export interface DesktopTaskResult extends TaskResult {
	readonly key: string;
	readonly sessionPath: string;
	readonly cwd: string;
	readonly read: boolean;
	readonly openTarget: Exclude<DesktopSessionOpenTarget, "unavailable">;
}

export interface ResultInboxSnapshot {
	readonly tasks: readonly DesktopTaskResult[];
	readonly unavailableCount: number;
	readonly truncated: boolean;
}

export const RESULT_INBOX_CHANNELS = {
	LIST: "567:result-inbox:list",
	READ: "567:result-inbox:read",
} as const;
