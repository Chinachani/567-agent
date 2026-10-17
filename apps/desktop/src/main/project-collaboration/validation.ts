import type {
	CollaborationAccess,
	CollaborationTaskStatus,
	ProjectCollaborationDocument,
	ProjectCollaborationMember,
	ProjectCollaborationPatch,
	ProjectCollaborationTask,
} from "../../shared/project-collaboration.js";

import { MAX_COLLABORATION_MEMBERS as MAX_MEMBERS, MAX_COLLABORATION_TASKS as MAX_TASKS } from "./limits.js";

const MAX_SESSION_ID_LENGTH = 256;
const MAX_TASK_ID_LENGTH = 256;
const MAX_REQUEST_KEY_LENGTH = 256;
const MAX_RESPONSIBILITY_LENGTH = 4000;
const MAX_OBJECTIVE_LENGTH = 32000;
const MAX_RESULT_LENGTH = 64000;
const MAX_ERROR_LENGTH = 16000;

const ACCESS_VALUES = new Set<CollaborationAccess>(["read", "write"]);
const STATUS_VALUES = new Set<CollaborationTaskStatus>([
	"queued",
	"running",
	"waiting",
	"completed",
	"failed",
	"interrupted",
	"cancelled",
	"attention",
]);
const KIND_VALUES = new Set<ProjectCollaborationTask["kind"]>(["task", "question", "notice", "result"]);
const PATCH_KEYS = new Set(["revision", "enabled", "paused", "coordinatorSessionId", "members"]);
const DOCUMENT_KEYS = new Set(["schemaVersion", "config", "tasks"]);
const CONFIG_KEYS = new Set(["schemaVersion", "revision", "enabled", "paused", "coordinatorSessionId", "members"]);
const TASK_KEYS = new Set([
	"id",
	"rootId",
	"parentId",
	"requestKey",
	"sourceSessionId",
	"targetSessionId",
	"kind",
	"access",
	"objective",
	"status",
	"createdAt",
	"startedAt",
	"finishedAt",
	"result",
	"error",
	"reviewRound",
	"resume",
	"stage",
	"deliveredToSource",
	"resultVersion",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, name: string): void {
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) throw new Error(`Invalid project collaboration ${name} field: ${key}`);
	}
}

function assertString(value: unknown, name: string, maxLength: number, allowEmpty = false): asserts value is string {
	if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && value.trim().length === 0)) {
		throw new Error(`Invalid project collaboration ${name}`);
	}
}

function assertOptionalString(
	record: Record<string, unknown>,
	key: string,
	maxLength: number,
	allowEmpty = true,
): void {
	if (Object.hasOwn(record, key) && record[key] !== undefined) {
		assertString(record[key], key, maxLength, allowEmpty);
	} else if (Object.hasOwn(record, key)) {
		throw new Error(`Invalid project collaboration ${key}`);
	}
}

function assertRevision(value: unknown, name: string): asserts value is number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`Invalid project collaboration ${name}`);
}

function assertBoolean(value: unknown, name: string): asserts value is boolean {
	if (typeof value !== "boolean") throw new Error(`Invalid project collaboration ${name}`);
}

function validateMember(value: unknown): ProjectCollaborationMember {
	if (!isRecord(value)) throw new Error("Invalid project collaboration member");
	assertOnlyKeys(value, new Set(["sessionId", "responsibility", "access"]), "member");
	assertString(value.sessionId, "member sessionId", MAX_SESSION_ID_LENGTH);
	assertString(value.responsibility, "member responsibility", MAX_RESPONSIBILITY_LENGTH, true);
	if (!ACCESS_VALUES.has(value.access as CollaborationAccess)) {
		throw new Error("Invalid project collaboration member access");
	}
	return {
		sessionId: value.sessionId,
		responsibility: value.responsibility,
		access: value.access as CollaborationAccess,
	};
}

function validateMembers(value: unknown): readonly ProjectCollaborationMember[] {
	if (!Array.isArray(value) || value.length > MAX_MEMBERS) {
		throw new Error("Invalid project collaboration members");
	}
	const members = value.map(validateMember);
	const sessionIds = new Set<string>();
	for (const member of members) {
		if (sessionIds.has(member.sessionId)) throw new Error("Duplicate project collaboration member sessionId");
		sessionIds.add(member.sessionId);
	}
	return members;
}

function validateTask(value: unknown): ProjectCollaborationTask {
	if (!isRecord(value)) throw new Error("Invalid project collaboration task");
	assertOnlyKeys(value, TASK_KEYS, "task");
	assertString(value.id, "task id", MAX_TASK_ID_LENGTH);
	assertString(value.rootId, "task rootId", MAX_TASK_ID_LENGTH);
	assertOptionalString(value, "parentId", MAX_TASK_ID_LENGTH, false);
	assertString(value.requestKey, "task requestKey", MAX_REQUEST_KEY_LENGTH);
	assertString(value.sourceSessionId, "task sourceSessionId", MAX_SESSION_ID_LENGTH);
	assertString(value.targetSessionId, "task targetSessionId", MAX_SESSION_ID_LENGTH);
	if (!KIND_VALUES.has(value.kind as ProjectCollaborationTask["kind"])) {
		throw new Error("Invalid project collaboration task kind");
	}
	if (!ACCESS_VALUES.has(value.access as CollaborationAccess))
		throw new Error("Invalid project collaboration task access");
	assertString(value.objective, "task objective", MAX_OBJECTIVE_LENGTH);
	if (!STATUS_VALUES.has(value.status as CollaborationTaskStatus)) {
		throw new Error("Invalid project collaboration task status");
	}
	for (const field of ["createdAt", "startedAt", "finishedAt", "reviewRound"] as const) {
		if (!Object.hasOwn(value, field) && field !== "createdAt" && field !== "reviewRound") continue;
		const candidate = value[field];
		if (!Number.isSafeInteger(candidate) || Number(candidate) < 0) {
			throw new Error(`Invalid project collaboration task ${field}`);
		}
	}
	if (
		value.stage !== undefined &&
		(typeof value.stage !== "string" || !["work", "review", "fix"].includes(value.stage))
	)
		throw new Error("Invalid project collaboration task stage");
	if (Number(value.reviewRound) > 3) throw new Error("Invalid project collaboration review round");
	if (value.resultVersion !== undefined) assertRevision(value.resultVersion, "task resultVersion");
	if (value.deliveredToSource !== undefined) assertBoolean(value.deliveredToSource, "task deliveredToSource");
	if (value.resume !== undefined) assertBoolean(value.resume, "task resume");
	assertOptionalString(value, "result", MAX_RESULT_LENGTH);
	assertOptionalString(value, "error", MAX_ERROR_LENGTH);
	return {
		id: value.id,
		rootId: value.rootId,
		...(value.parentId === undefined ? {} : { parentId: value.parentId as string }),
		requestKey: value.requestKey,
		sourceSessionId: value.sourceSessionId,
		targetSessionId: value.targetSessionId,
		kind: value.kind as ProjectCollaborationTask["kind"],
		access: value.access as CollaborationAccess,
		objective: value.objective,
		status: value.status as CollaborationTaskStatus,
		createdAt: value.createdAt as number,
		...(value.startedAt === undefined ? {} : { startedAt: value.startedAt as number }),
		...(value.finishedAt === undefined ? {} : { finishedAt: value.finishedAt as number }),
		...(value.result === undefined ? {} : { result: value.result as string }),
		...(value.error === undefined ? {} : { error: value.error as string }),
		reviewRound: value.reviewRound as number,
		...(value.resume === undefined ? {} : { resume: value.resume as boolean }),
		...(value.resultVersion === undefined ? {} : { resultVersion: value.resultVersion as number }),
		...(value.deliveredToSource === undefined ? {} : { deliveredToSource: value.deliveredToSource as boolean }),
		...(value.stage === undefined ? {} : { stage: value.stage as ProjectCollaborationTask["stage"] }),
	};
}

function validateTasks(value: unknown): readonly ProjectCollaborationTask[] {
	if (!Array.isArray(value) || value.length > MAX_TASKS) throw new Error("Invalid project collaboration tasks");
	const tasks = value.map(validateTask);
	const ids = new Set<string>();
	for (const task of tasks) {
		if (ids.has(task.id)) throw new Error("Duplicate project collaboration task id");
		ids.add(task.id);
	}
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const complete = new Set<string>();
	for (const task of tasks) {
		const chain = new Set<string>();
		let cursor: ProjectCollaborationTask | undefined = task;
		while (cursor && !complete.has(cursor.id)) {
			if (chain.has(cursor.id)) throw new Error("Project collaboration task dependencies contain a cycle");
			chain.add(cursor.id);
			cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
		}
		for (const id of chain) complete.add(id);
	}
	return tasks;
}

function validateConfig(value: unknown): ProjectCollaborationDocument["config"] {
	if (!isRecord(value)) throw new Error("Invalid project collaboration config");
	assertOnlyKeys(value, CONFIG_KEYS, "config");
	if (value.schemaVersion !== 1) throw new Error("Unsupported project collaboration config schema");
	assertRevision(value.revision, "revision");
	assertBoolean(value.enabled, "enabled");
	assertBoolean(value.paused, "paused");
	const coordinatorSessionId = value.coordinatorSessionId;
	if (coordinatorSessionId !== null) assertString(coordinatorSessionId, "coordinatorSessionId", MAX_SESSION_ID_LENGTH);
	const members = validateMembers(value.members);
	if (coordinatorSessionId !== null && !members.some((member) => member.sessionId === coordinatorSessionId)) {
		throw new Error("Project collaboration coordinator must be a member");
	}
	return {
		schemaVersion: 1,
		revision: value.revision,
		enabled: value.enabled,
		paused: value.paused,
		coordinatorSessionId: coordinatorSessionId as string | null,
		members,
	};
}

export function validatePatch(value: unknown): ProjectCollaborationPatch {
	if (!isRecord(value)) throw new Error("Invalid project collaboration patch");
	assertOnlyKeys(value, PATCH_KEYS, "patch");
	assertRevision(value.revision, "patch revision");
	if (Object.hasOwn(value, "enabled")) assertBoolean(value.enabled, "patch enabled");
	if (Object.hasOwn(value, "paused")) assertBoolean(value.paused, "patch paused");
	let coordinatorSessionId: string | null | undefined;
	if (Object.hasOwn(value, "coordinatorSessionId")) {
		coordinatorSessionId = value.coordinatorSessionId as string | null;
		if (coordinatorSessionId !== null) {
			assertString(coordinatorSessionId, "patch coordinatorSessionId", MAX_SESSION_ID_LENGTH);
		}
	}
	const members = Object.hasOwn(value, "members") ? validateMembers(value.members) : undefined;
	return {
		revision: value.revision,
		...(Object.hasOwn(value, "enabled") ? { enabled: value.enabled as boolean } : {}),
		...(Object.hasOwn(value, "paused") ? { paused: value.paused as boolean } : {}),
		...(Object.hasOwn(value, "coordinatorSessionId") ? { coordinatorSessionId } : {}),
		...(members === undefined ? {} : { members }),
	};
}

export function validateDocument(value: unknown): ProjectCollaborationDocument {
	if (!isRecord(value)) throw new Error("Invalid project collaboration document");
	assertOnlyKeys(value, DOCUMENT_KEYS, "document");
	if (value.schemaVersion !== 1) throw new Error("Unsupported project collaboration document schema");
	const config = validateConfig(value.config);
	const tasks = validateTasks(value.tasks);
	return { schemaVersion: 1, config, tasks };
}
