import { createHash } from "node:crypto";
import type { ProjectCollaborationDocument, ProjectCollaborationTask } from "../../shared/project-collaboration.js";
import { MAX_COLLABORATION_BYTES, MAX_COLLABORATION_TASKS } from "./limits.js";

export interface CollaborationDispatch {
	readonly target: string;
	readonly objective: string;
	readonly kind?: "task" | "question" | "notice";
	readonly access?: "read" | "write";
	readonly stage?: "work" | "review" | "fix";
	readonly requestId: string;
}
interface Admission {
	readonly id: string;
	readonly sourceId: string;
	readonly targetId: string;
	readonly turnId: string;
	readonly parent?: ProjectCollaborationTask;
	readonly input: CollaborationDispatch;
	readonly now: number;
}
export function admitCollaborationTask(
	current: ProjectCollaborationDocument,
	{ id, sourceId, targetId, turnId, parent, input, now }: Admission,
): { document: ProjectCollaborationDocument; task: ProjectCollaborationTask } {
	if (!current.config.enabled || current.config.paused) throw new Error("Project collaboration is disabled or paused");
	if (
		!current.config.members.some((item) => item.sessionId === sourceId) ||
		!current.config.members.some((item) => item.sessionId === targetId)
	)
		throw new Error("Both source and target must join this project's collaboration first");
	const requestKey = createHash("sha256")
		.update(JSON.stringify([sourceId, turnId, input.requestId]))
		.digest("hex");
	const existing = current.tasks.find((task) => task.requestKey === requestKey);
	if (existing) {
		return { document: current, task: existing };
	}
	if (
		current.tasks.length >= MAX_COLLABORATION_TASKS - 10 ||
		Buffer.byteLength(JSON.stringify(current)) > MAX_COLLABORATION_BYTES - 2 * 1024 * 1024
	)
		throw new Error(
			"Collaboration history is full. Export a backup and use a new project before dispatching more work; existing results remain available.",
		);
	const rootId =
		parent?.rootId ??
		createHash("sha256")
			.update(JSON.stringify([sourceId, turnId]))
			.digest("hex");
	const rootTasks = current.tasks.filter((task) => task.rootId === rootId);
	const attention = rootTasks.find((task) => task.status === "attention");
	if (attention) return { document: current, task: attention };
	const currentRound = Math.max(0, ...rootTasks.map((task) => task.reviewRound));
	const nextReview =
		input.stage === "review" &&
		(currentRound === 0 || rootTasks.some((task) => task.reviewRound === currentRound && task.stage === "fix"));
	const round = currentRound + (nextReview ? 1 : 0);
	const membership = current.config.members.find((member) => member.sessionId === targetId)!;
	const access = input.access ?? "read";
	if (access === "write" && membership.access !== "write")
		throw new Error("The target conversation is configured for read-only collaboration");
	const admitted: ProjectCollaborationTask = {
		id,
		rootId,
		...(parent ? { parentId: parent.id } : {}),
		requestKey,
		sourceSessionId: sourceId,
		targetSessionId: targetId,
		kind: input.kind ?? "task",
		stage: input.stage ?? "work",
		access,
		objective: input.objective,
		status: round > 3 || rootTasks.length >= 32 ? "attention" : input.kind === "notice" ? "completed" : "queued",
		createdAt: now,
		reviewRound: Math.min(round, 3),
		...(round > 3 || rootTasks.length >= 32
			? { error: "Automatic collaboration budget reached; ask the user before continuing" }
			: {}),
	};
	return { document: { ...current, tasks: [...current.tasks, admitted] }, task: admitted };
}
export function collaborationTaskBranchIds(document: ProjectCollaborationDocument, reference: string): Set<string> {
	const children = new Map<string, string[]>();
	for (const task of document.tasks)
		if (task.parentId) children.set(task.parentId, [...(children.get(task.parentId) ?? []), task.id]);
	const queue = document.tasks
		.filter((task) => task.id === reference || task.rootId === reference)
		.map((task) => task.id);
	const ids = new Set<string>();
	while (queue.length) {
		const id = queue.pop()!;
		if (ids.has(id)) continue;
		ids.add(id);
		for (const child of children.get(id) ?? []) queue.push(child);
	}
	return ids;
}

export function isPendingCollaborationTask(task: ProjectCollaborationTask): boolean {
	return task.status === "queued" || task.status === "running" || task.status === "waiting";
}

/** Result turns continue the original work scope rather than becoming a new peer request. */
export function collaborationScopeTask(
	document: ProjectCollaborationDocument,
	task: ProjectCollaborationTask,
): ProjectCollaborationTask {
	if (task.kind !== "result") return task;
	const child = document.tasks.find((item) => item.id === task.parentId);
	const enclosing = child?.parentId ? document.tasks.find((item) => item.id === child.parentId) : undefined;
	return enclosing?.targetSessionId === task.targetSessionId ? enclosing : task;
}

/** Collect sibling results before waking the coordinator; waiting ancestors never occupy a model slot. */
export function canRunCollaborationTask(
	document: ProjectCollaborationDocument,
	task: ProjectCollaborationTask,
): boolean {
	const directParent = task.parentId ? document.tasks.find((item) => item.id === task.parentId) : undefined;
	let ancestor =
		task.kind === "result"
			? directParent?.parentId
				? document.tasks.find((item) => item.id === directParent.parentId)
				: undefined
			: directParent;
	while (ancestor) {
		if (["cancelled", "interrupted", "failed", "attention"].includes(ancestor.status)) return false;
		ancestor = ancestor.parentId ? document.tasks.find((item) => item.id === ancestor?.parentId) : undefined;
	}
	if (task.kind !== "result") return true;
	const child = document.tasks.find((item) => item.id === task.parentId);
	return !document.tasks.some(
		(item) =>
			item.kind !== "result" &&
			item.sourceSessionId === task.targetSessionId &&
			item.rootId === task.rootId &&
			item.parentId === child?.parentId &&
			isPendingCollaborationTask(item),
	);
}

function notificationObjective(task: ProjectCollaborationTask, siblings: readonly ProjectCollaborationTask[]): string {
	const text = task.result ?? task.error ?? "";
	return JSON.stringify({
		taskId: task.id,
		taskIds: siblings.map((item) => item.id),
		status: task.status,
		result: text.slice(0, 4000),
		hasMore: text.length > 4000,
		readFullResult: "project_collaboration_read_task",
	});
}
export function consumeCollaborationTaskResult(
	current: ProjectCollaborationDocument,
	taskId: string,
	version: number,
	now: number,
): ProjectCollaborationDocument {
	const original = current.tasks.find((task) => task.id === taskId);
	if (!original || (original.resultVersion ?? 0) !== version) return current;
	let tasks: ProjectCollaborationTask[] = current.tasks.map((task) =>
		task.id === taskId ? { ...task, deliveredToSource: true } : task,
	);
	tasks = tasks.map((notification) => {
		if (
			notification.kind !== "result" ||
			(notification.status !== "queued" && notification.status !== "attention") ||
			notification.targetSessionId !== original.sourceSessionId ||
			notification.rootId !== original.rootId
		)
			return notification;
		const child = tasks.find((task) => task.id === notification.parentId);
		if (!child || child.parentId !== original.parentId) return notification;
		const remaining = tasks.filter(
			(task) =>
				task.kind !== "result" &&
				task.sourceSessionId === original.sourceSessionId &&
				task.rootId === original.rootId &&
				task.parentId === original.parentId &&
				!task.deliveredToSource &&
				!isPendingCollaborationTask(task),
		);
		const latest = remaining.at(-1);
		return latest
			? {
					...notification,
					parentId: latest.id,
					sourceSessionId: latest.targetSessionId,
					objective: notificationObjective(latest, remaining),
				}
			: { ...notification, status: "cancelled", finishedAt: now };
	});
	return { ...current, tasks };
}

export function completeCollaborationTask(
	current: ProjectCollaborationDocument,
	task: ProjectCollaborationTask,
	status: ProjectCollaborationTask["status"],
	text: string,
	now: number,
	resultId: string,
): ProjectCollaborationDocument {
	const stored = current.tasks.find((item) => item.id === task.id);
	if (!stored || stored.status !== "running") return current;
	let tasks: ProjectCollaborationTask[] = current.tasks.map((item) =>
		item.id === task.id
			? {
					...item,
					status,
					finishedAt: now,
					resultVersion: (item.resultVersion ?? 0) + 1,
					...(status === "completed" ? { result: text.slice(0, 64000) } : { error: text.slice(0, 16000) }),
				}
			: item,
	);
	if (status === "cancelled" || status === "interrupted") return { ...current, tasks };

	let publish = tasks.find((item) => item.id === task.id)!;
	if (task.kind === "result") {
		const enclosing = collaborationScopeTask({ ...current, tasks }, task);
		if (enclosing.id !== task.id) {
			if (!["waiting", "completed"].includes(enclosing.status)) return { ...current, tasks };
			// A continuation reports back to its original parent, never to the peer that supplied the result.
			publish = {
				...enclosing,
				status,
				finishedAt: now,
				resultVersion: (enclosing.resultVersion ?? 0) + 1,
				deliveredToSource: false,
				...(status === "completed" ? { result: text.slice(0, 64000) } : { error: text.slice(0, 16000) }),
			};
		}
	}
	const childrenPending = tasks.some(
		(item) => item.parentId === publish.id && item.kind !== "result" && isPendingCollaborationTask(item),
	);
	const resultsPending = tasks.some(
		(item) =>
			item.id !== task.id &&
			item.kind === "result" &&
			isPendingCollaborationTask(item) &&
			tasks.find((child) => child.id === item.parentId)?.parentId === publish.id,
	);
	if (status === "completed" && (childrenPending || resultsPending)) publish = { ...publish, status: "waiting" };
	tasks = tasks.map((item) => (item.id === publish.id ? publish : item));
	if (
		publish.kind === "result" ||
		publish.status === "waiting" ||
		publish.deliveredToSource ||
		!current.config.members.some((member) => member.sessionId === publish.sourceSessionId)
	)
		return { ...current, tasks };
	const source = current.config.members.find((member) => member.sessionId === publish.sourceSessionId)!;
	const groupParent = publish.parentId;
	const sourceScope = groupParent ? tasks.find((item) => item.id === groupParent) : undefined;
	const pending = tasks.find(
		(item) =>
			item.kind === "result" &&
			item.status === "queued" &&
			item.rootId === publish.rootId &&
			item.targetSessionId === publish.sourceSessionId &&
			tasks.find((child) => child.id === item.parentId)?.parentId === groupParent,
	);
	const unconsumed = tasks.filter(
		(item) =>
			item.kind !== "result" &&
			item.rootId === publish.rootId &&
			item.sourceSessionId === publish.sourceSessionId &&
			item.parentId === groupParent &&
			!item.deliveredToSource &&
			!isPendingCollaborationTask(item),
	);
	const notification: ProjectCollaborationTask = {
		id: pending?.id ?? resultId,
		rootId: publish.rootId,
		parentId: publish.id,
		requestKey: pending?.requestKey ?? `result:${publish.id}:${publish.resultVersion ?? 0}`,
		sourceSessionId: publish.targetSessionId,
		targetSessionId: publish.sourceSessionId,
		kind: "result",
		access: sourceScope?.access === "read" ? "read" : source.access,
		objective: JSON.stringify({
			taskId: publish.id,
			taskIds: unconsumed.map((item) => item.id),
			status: publish.status,
			result: text.slice(0, 4000),
			hasMore: text.length > 4000,
			readFullResult: "project_collaboration_read_task",
		}),
		status:
			(publish.parentId &&
				tasks.some(
					(item) => item.id === publish.parentId && ["interrupted", "cancelled", "failed"].includes(item.status),
				)) ||
			(!pending && tasks.filter((item) => item.rootId === publish.rootId).length >= 32)
				? "attention"
				: "queued",
		createdAt: pending?.createdAt ?? now,
		reviewRound: publish.reviewRound,
	};
	return {
		...current,
		tasks: pending ? tasks.map((item) => (item.id === pending.id ? notification : item)) : [...tasks, notification],
	};
}
