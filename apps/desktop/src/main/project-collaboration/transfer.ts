import { randomUUID } from "node:crypto";
import type { ProjectCollaborationDocument, ProjectCollaborationTask } from "../../shared/project-collaboration.js";
import { MAX_COLLABORATION_MEMBERS, MAX_COLLABORATION_TASKS } from "./limits.js";
import { isPendingCollaborationTask } from "./task-state.js";
import { validateDocument } from "./validation.js";

/** Portable collaboration state. Its session IDs are source IDs until import remaps them. */
export type ProjectCollaborationTransfer = ProjectCollaborationDocument;

export function parseProjectCollaborationTransfer(value: unknown): ProjectCollaborationTransfer {
	return validateDocument(value);
}

export function createProjectCollaborationTransfer(
	document: ProjectCollaborationDocument,
	availableSessionIds: ReadonlySet<string>,
): ProjectCollaborationTransfer {
	const valid = validateDocument(document);
	const members = valid.config.members.filter((member) => availableSessionIds.has(member.sessionId));
	const memberIds = new Set(members.map((member) => member.sessionId));
	const tasks = valid.tasks.filter(
		(task) => availableSessionIds.has(task.sourceSessionId) && availableSessionIds.has(task.targetSessionId),
	);
	return validateDocument({
		schemaVersion: 1,
		config: {
			...valid.config,
			revision: 0,
			paused: valid.config.paused,
			coordinatorSessionId:
				valid.config.coordinatorSessionId && memberIds.has(valid.config.coordinatorSessionId)
					? valid.config.coordinatorSessionId
					: null,
			members,
		},
		tasks: tasks.map(interruptActiveTask),
	});
}

export function remapProjectCollaborationTransfer(
	transferValue: unknown,
	sessionIds: ReadonlyMap<string, string>,
): ProjectCollaborationDocument {
	const transfer = parseProjectCollaborationTransfer(transferValue);
	const members = transfer.config.members.flatMap((member) => {
		const sessionId = sessionIds.get(member.sessionId);
		return sessionId ? [{ ...member, sessionId }] : [];
	});
	const memberIds = new Set(members.map((member) => member.sessionId));
	const coordinatorSourceId = transfer.config.coordinatorSessionId;
	const coordinatorSessionId = coordinatorSourceId ? (sessionIds.get(coordinatorSourceId) ?? null) : null;
	const mappedTasks = transfer.tasks.filter(
		(task) => sessionIds.has(task.sourceSessionId) && sessionIds.has(task.targetSessionId),
	);
	const taskIds = new Map(mappedTasks.map((task) => [task.id, randomUUID()]));
	const rootIds = new Map(
		mappedTasks
			.map((task) => task.rootId)
			.filter((id, index, all) => all.indexOf(id) === index)
			.map((id) => [id, randomUUID()]),
	);
	const tasks = mappedTasks.flatMap((task) => {
		const sourceSessionId = sessionIds.get(task.sourceSessionId);
		const targetSessionId = sessionIds.get(task.targetSessionId);
		const id = taskIds.get(task.id);
		if (!sourceSessionId || !targetSessionId || !id) return [];
		const resultObjective = task.kind === "result" ? remapResultObjectiveTaskId(task.objective, taskIds) : undefined;
		if (task.kind === "result" && !resultObjective) return [];
		const { parentId: _sourceParentId, ...taskWithoutParent } = interruptActiveTask(task);
		return [
			{
				...taskWithoutParent,
				id,
				rootId: rootIds.get(task.rootId) ?? id,
				...(task.parentId && taskIds.has(task.parentId) ? { parentId: taskIds.get(task.parentId)! } : {}),
				sourceSessionId,
				targetSessionId,
				...(resultObjective === undefined ? {} : { objective: resultObjective }),
			},
		];
	});
	return validateDocument({
		schemaVersion: 1,
		config: {
			...transfer.config,
			revision: 0,
			paused: transfer.config.paused,
			coordinatorSessionId:
				coordinatorSessionId && memberIds.has(coordinatorSessionId) ? coordinatorSessionId : null,
			members,
		},
		tasks,
	});
}

export function mergeImportedProjectCollaboration(
	currentValue: ProjectCollaborationDocument,
	importedValue: ProjectCollaborationDocument,
): ProjectCollaborationDocument {
	const current = validateDocument(currentValue);
	const imported = validateDocument(importedValue);
	if (imported.config.members.length === 0 && imported.tasks.length === 0) return current;
	const members = [...current.config.members];
	const knownMembers = new Set(members.map((member) => member.sessionId));
	const newMembers = imported.config.members.filter((member) => !knownMembers.has(member.sessionId));
	if (members.length + newMembers.length > MAX_COLLABORATION_MEMBERS) {
		throw new Error(`Imported collaboration exceeds the ${MAX_COLLABORATION_MEMBERS} member limit`);
	}
	members.push(...newMembers);
	for (const member of newMembers) knownMembers.add(member.sessionId);
	const tasks = [...current.tasks];
	const knownTasks = new Set(tasks.map((task) => task.id));
	const newTasks = imported.tasks.filter((task) => !knownTasks.has(task.id));
	if (tasks.length + newTasks.length > MAX_COLLABORATION_TASKS) {
		throw new Error(`Imported collaboration exceeds the ${MAX_COLLABORATION_TASKS} task limit`);
	}
	tasks.push(...newTasks);
	const coordinatorSessionId =
		current.config.coordinatorSessionId && knownMembers.has(current.config.coordinatorSessionId)
			? current.config.coordinatorSessionId
			: imported.config.coordinatorSessionId;
	const currentHasActiveTasks = current.tasks.some(isPendingCollaborationTask);
	return validateDocument({
		schemaVersion: 1,
		config: {
			...current.config,
			enabled: current.config.enabled || imported.config.enabled,
			paused: current.config.paused || (!currentHasActiveTasks && imported.config.paused),
			coordinatorSessionId,
			members,
		},
		tasks,
	});
}

function remapResultObjectiveTaskId(objective: string, taskIds: ReadonlyMap<string, string>): string | undefined {
	let value: unknown;
	try {
		value = JSON.parse(objective);
	} catch {
		return objective;
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return objective;
	const record = value as Record<string, unknown>;
	if (typeof record.taskId !== "string") return objective;
	const taskId = taskIds.get(record.taskId);
	return taskId
		? JSON.stringify({
				...record,
				taskId,
				...(Array.isArray(record.taskIds)
					? {
							taskIds: record.taskIds.flatMap((id) =>
								typeof id === "string" && taskIds.has(id) ? [taskIds.get(id)!] : [],
							),
						}
					: {}),
			})
		: undefined;
}

export function rollbackImportedProjectCollaboration(
	currentValue: ProjectCollaborationDocument,
	beforeImportValue: ProjectCollaborationDocument,
	writtenValue: ProjectCollaborationDocument,
): ProjectCollaborationDocument {
	const current = validateDocument(currentValue);
	const beforeImport = validateDocument(beforeImportValue);
	const written = validateDocument(writtenValue);
	const originalMemberIds = new Set(beforeImport.config.members.map((member) => member.sessionId));
	const importedMemberIds = new Set(
		written.config.members
			.filter((member) => !originalMemberIds.has(member.sessionId))
			.map((member) => member.sessionId),
	);
	const originalTaskIds = new Set(beforeImport.tasks.map((task) => task.id));
	const importedTaskIds = new Set(
		written.tasks.filter((task) => !originalTaskIds.has(task.id)).map((task) => task.id),
	);
	const members = current.config.members.filter((member) => !importedMemberIds.has(member.sessionId));
	const tasks = current.tasks.filter((task) => !importedTaskIds.has(task.id));
	const writtenConfigStillCurrent =
		current.config.revision === written.config.revision &&
		current.config.enabled === written.config.enabled &&
		current.config.paused === written.config.paused &&
		current.config.coordinatorSessionId === written.config.coordinatorSessionId &&
		JSON.stringify(current.config.members) === JSON.stringify(written.config.members);
	const currentCoordinator = current.config.coordinatorSessionId;
	const restoredCoordinator = beforeImport.config.coordinatorSessionId;
	const coordinatorSessionId = writtenConfigStillCurrent
		? restoredCoordinator && members.some((member) => member.sessionId === restoredCoordinator)
			? restoredCoordinator
			: null
		: currentCoordinator && members.some((member) => member.sessionId === currentCoordinator)
			? currentCoordinator
			: null;
	return validateDocument({
		schemaVersion: 1,
		config: {
			...current.config,
			enabled: writtenConfigStillCurrent ? beforeImport.config.enabled : current.config.enabled,
			paused: writtenConfigStillCurrent ? beforeImport.config.paused : current.config.paused,
			coordinatorSessionId,
			members,
		},
		tasks,
	});
}

function interruptActiveTask(task: ProjectCollaborationTask): ProjectCollaborationTask {
	if (!isPendingCollaborationTask(task)) return task;
	const { startedAt: _startedAt, finishedAt: _finishedAt, result: _result, ...rest } = task;
	return {
		...rest,
		status: "interrupted",
		error: "Imported from a backup; inspect existing results before continuing",
		...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
		finishedAt: Date.now(),
	};
}
