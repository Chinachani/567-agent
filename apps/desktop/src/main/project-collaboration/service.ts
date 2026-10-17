import { randomUUID } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import type { CodingAgentPinnedModelContext } from "@567agent/coding-agent/runtime";
import type {
	ProjectCollaborationCandidate,
	ProjectCollaborationControl,
	ProjectCollaborationDocument,
	ProjectCollaborationSnapshot,
	ProjectCollaborationTask,
} from "../../shared/project-collaboration.js";
import { stopSessionBackgroundWork } from "../agent-runtime/stop-session-work.js";
import { readDesktopConfig } from "../config/desktop-config-store.js";
import {
	type DesktopConversationSession,
	getDesktopConversationService,
} from "../conversations/desktop-conversation-service.js";
import { samePath } from "../conversations/session-paths.js";
import { mainT } from "../i18n/index.js";
import { getAppLogger } from "../logger.js";
import { getSharedRuntime } from "../runtime.js";
import { ProjectCollaborationCatalog } from "./catalog.js";
import { collaborationContext } from "./context.js";
import {
	beginCollaborationTurn,
	finishCollaborationTurn,
	registerCollaborationSession,
	releaseCollaborationWriter,
	setCollaborationReadOnly,
	unregisterCollaborationSession,
} from "./execution-guard.js";
import { CollaborationScheduler } from "./scheduler.js";
import { createCollaborationStore, type ProjectCollaborationStore } from "./store.js";
import {
	admitCollaborationTask,
	type CollaborationDispatch,
	collaborationScopeTask,
	collaborationTaskBranchIds,
	completeCollaborationTask,
	consumeCollaborationTaskResult,
	isPendingCollaborationTask,
} from "./task-state.js";
import { validatePatch } from "./validation.js";

const log = getAppLogger("project-collaboration");
interface ProjectState {
	readonly store: ProjectCollaborationStore;
	document: ProjectCollaborationDocument;
}

export class ProjectCollaborationService {
	private readonly projects = new Map<string, Promise<ProjectState>>();
	private readonly sessions = new Map<string, DesktopConversationSession>();
	private readonly subscriptions = new Map<string, () => void>();
	private readonly listeners = new Set<(event: { cwd: string }) => void>();
	private readonly scheduler = new CollaborationScheduler({
		read: (cwd) => this.document(cwd),
		settled: (cwd) => this.changed(cwd),
		mutate: (cwd, edit) => this.mutate(cwd, edit),
		isBusy: (id) => {
			try {
				const runtime = getSharedRuntime();
				return runtime.getState(id).isStreaming || runtime.getQueueState(id).entries.length > 0;
			} catch {
				return false;
			}
		},
		execute: (cwd, task, signal) => this.execute(cwd, task, signal),
		complete: (cwd, task, status, result) => this.complete(cwd, task, status, result),
	});
	onChanged(listener: (event: { cwd: string }) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	private changed(cwd: string): void {
		for (const listener of this.listeners) {
			try {
				listener({ cwd });
			} catch (error) {
				log.warn("collaboration observer failed", error);
			}
		}
	}
	async project(cwd: unknown): Promise<string> {
		if (typeof cwd !== "string" || !isAbsolute(cwd) || cwd.includes("\0"))
			throw new Error("Invalid project directory");
		const config = await readDesktopConfig();
		const project = config.projects.find((item) => samePath(item.path, cwd));
		if (!project) throw new Error("Project is not registered or has been removed");
		return resolve(project.path);
	}
	private state(cwd: string): Promise<ProjectState> {
		let pending = this.projects.get(cwd);
		if (!pending) {
			pending = (async () => {
				const store = createCollaborationStore(cwd);
				let document = await store.read();
				if (document.tasks.some(isPendingCollaborationTask)) {
					document = await store.update((current) => ({
						...current,
						config: { ...current.config, paused: true },
						tasks: current.tasks.map((task) =>
							isPendingCollaborationTask(task)
								? {
										...task,
										status: "interrupted",
										error: "Desktop restarted; inspect existing results before continuing",
									}
								: task,
						),
					}));
				}
				return { store, document };
			})();
			this.projects.set(cwd, pending);
			void pending.catch(() => {
				if (this.projects.get(cwd) === pending) this.projects.delete(cwd);
			});
		}
		return pending;
	}
	private async document(cwd: string): Promise<ProjectCollaborationDocument> {
		return (await this.state(cwd)).document;
	}
	private async mutate(
		cwd: string,
		edit: (doc: ProjectCollaborationDocument) => ProjectCollaborationDocument,
	): Promise<ProjectCollaborationDocument> {
		const state = await this.state(cwd);
		state.document = await state.store.update(edit);
		this.changed(cwd);
		return state.document;
	}
	/** Import adapters use the same serialized write queue to refresh an already-open project. */
	async refreshStoredProject(directory: string): Promise<void> {
		const cwd = [...this.projects.keys()].find((path) => samePath(path, directory));
		if (!cwd) return;
		await this.mutate(cwd, (document) => document);
		this.scheduler.wake(cwd);
	}
	private catalog(): ProjectCollaborationCatalog {
		return new ProjectCollaborationCatalog(getSharedRuntime());
	}
	async read(directory: string): Promise<ProjectCollaborationSnapshot> {
		const cwd = await this.project(directory);
		const document = await this.document(cwd);
		return {
			cwd,
			config: document.config,
			candidates: await this.catalog().list(cwd),
			tasks: document.tasks.filter(
				(task, index) => isPendingCollaborationTask(task) || index >= document.tasks.length - 200,
			),
		};
	}
	async update(directory: string, value: unknown): Promise<ProjectCollaborationSnapshot> {
		const cwd = await this.project(directory);
		const patch = validatePatch(value);
		const members = patch.members;
		if (members) for (const member of members) await this.catalog().resolve(cwd, member.sessionId);
		await this.mutate(cwd, (current) => {
			if (patch.revision !== current.config.revision)
				throw new Error("Collaboration configuration changed; refresh before saving");
			const next = { ...current.config, ...patch };
			const restricted = current.config.members.filter(
				(member) =>
					member.access === "write" &&
					next.members.find((item) => item.sessionId === member.sessionId)?.access === "read",
			);
			if (
				restricted.some((member) =>
					current.tasks.some(
						(task) =>
							task.targetSessionId === member.sessionId &&
							task.access === "write" &&
							isPendingCollaborationTask(task),
					),
				)
			)
				throw new Error("Stop or finish write tasks before changing this member to read-only");
			const removed = current.config.members.filter(
				(member) => !next.members.some((item) => item.sessionId === member.sessionId),
			);
			const active = current.tasks.filter(isPendingCollaborationTask);
			if (
				removed.some((member) =>
					active.some(
						(task) => task.targetSessionId === member.sessionId || task.sourceSessionId === member.sessionId,
					),
				) ||
				(!next.enabled && active.length)
			)
				throw new Error(
					"Stop or finish active collaboration tasks before removing members or disabling collaboration",
				);
			return { ...current, config: next };
		});
		this.scheduler.wake(cwd);
		return this.read(cwd);
	}
	async control(directory: string, value: unknown): Promise<ProjectCollaborationSnapshot> {
		const cwd = await this.project(directory);
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid collaboration control");
		const input = value as Record<string, unknown>;
		if (
			Object.keys(input).some((key) => key !== "action" && key !== "taskId") ||
			typeof input.action !== "string" ||
			!["pause", "resume", "stop", "continue"].includes(input.action) ||
			(input.taskId !== undefined &&
				(typeof input.taskId !== "string" || !input.taskId.trim() || input.taskId.length > 256))
		)
			throw new Error("Invalid collaboration control");
		const control = input as unknown as ProjectCollaborationControl;
		const document = await this.document(cwd);
		const stoppedIds = control.taskId ? collaborationTaskBranchIds(document, control.taskId) : undefined;
		const stopping = control.action === "stop" ? this.scheduler.stop(cwd, stoppedIds) : undefined;
		await this.mutate(cwd, (current) => {
			if (control.action === "stop" && stoppedIds && control.taskId)
				for (const id of collaborationTaskBranchIds(current, control.taskId)) stoppedIds.add(id);
			if (control.action === "continue") {
				const task = current.tasks.find((item) => item.id === control.taskId);
				if (!task || !["failed", "interrupted", "attention", "cancelled"].includes(task.status))
					throw new Error("Task cannot be continued");
				if (!current.config.members.some((member) => member.sessionId === task.targetSessionId))
					throw new Error("Re-add the target conversation before continuing this task");
				return {
					...current,
					config: { ...current.config, enabled: true, paused: false },
					tasks: current.tasks.map((item) => {
						if (item.id !== task.id) return item;
						const { error: _error, result: _result, finishedAt: _finished, ...rest } = item;
						return {
							...rest,
							status: "queued",
							resume: !!item.startedAt,
							deliveredToSource: false,
							...(item.status === "attention" ? { rootId: randomUUID(), reviewRound: 0 } : {}),
						};
					}),
				};
			}
			return {
				...current,
				config: {
					...current.config,
					paused:
						control.action === "stop" && control.taskId ? current.config.paused : control.action !== "resume",
				},
				tasks:
					control.action === "stop"
						? current.tasks.map((task) =>
								(task.status === "queued" || task.status === "waiting") &&
								(!stoppedIds || stoppedIds.has(task.id))
									? { ...task, status: "cancelled", finishedAt: Date.now() }
									: task,
							)
						: current.tasks,
			};
		});
		await stopping;
		if (control.action === "stop") await this.scheduler.stop(cwd, stoppedIds);
		this.scheduler.wake(cwd);
		return this.read(cwd);
	}
	async prepareProject(cwd: string): Promise<void> {
		await this.document(await this.project(cwd));
	}
	async registerSession(session: DesktopConversationSession): Promise<void> {
		let cwd: string;
		try {
			cwd = await this.project(session.cwd);
		} catch {
			return;
		}
		const state = await this.state(cwd);
		if (this.sessions.has(session.sessionId)) return;
		this.sessions.set(session.sessionId, { ...session, cwd });
		registerCollaborationSession(session.sessionId, cwd, () => state.document.config.enabled);
		this.subscriptions.set(
			session.sessionId,
			getSharedRuntime().subscribe(session.sessionId, (event) => {
				if (event.type === "session.lifecycle" && event.phase === "agent_start")
					beginCollaborationTurn(session.sessionId);
				if (event.type === "session.lifecycle" && event.phase === "agent_end") {
					if (!this.scheduler.active(session.sessionId)) finishCollaborationTurn(session.sessionId);
					this.scheduler.wake(cwd);
					this.changed(cwd);
				}
			}),
		);
	}
	async unregisterSession(sessionId: string): Promise<void> {
		const active = this.scheduler.active(sessionId);
		const session = this.sessions.get(sessionId);
		if (active && session) await this.scheduler.stop(resolve(session.cwd), new Set([active.id]));
		this.subscriptions.get(sessionId)?.();
		this.subscriptions.delete(sessionId);
		this.sessions.delete(sessionId);
		unregisterCollaborationSession(sessionId);
	}
	async isProject(cwd: string | undefined): Promise<boolean> {
		if (!cwd) return false;
		const config = await readDesktopConfig();
		return config.projects.some((item) => samePath(item.path, cwd));
	}
	isSessionEngaged(sessionId: string): boolean {
		return this.scheduler.isEngaged(sessionId);
	}
	isExecuting(sessionId: string, taskId: string | undefined): boolean {
		return !!taskId && this.scheduler.active(sessionId)?.id === taskId;
	}
	async bindContext(
		cwd: string,
		sessionId: string,
		base?: CodingAgentPinnedModelContext,
	): Promise<CodingAgentPinnedModelContext> {
		return collaborationContext(
			await this.document(await this.project(cwd)),
			sessionId,
			base,
			this.scheduler.active(sessionId),
		);
	}
	async withManual<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
		const session = this.sessions.get(sessionId);
		if (!session) return run();
		try {
			return await this.scheduler.withManual(sessionId, () => {
				beginCollaborationTurn(sessionId);
				return run();
			});
		} finally {
			try {
				if (!getSharedRuntime().getState(sessionId).isStreaming) finishCollaborationTurn(sessionId);
			} catch {
				finishCollaborationTurn(sessionId);
			}
			this.scheduler.wake(resolve(session.cwd));
			this.changed(resolve(session.cwd));
		}
	}
	async stopSession(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		const cwd = await this.project(session.cwd);
		const active = this.scheduler.active(sessionId);
		if (active) {
			await this.control(cwd, { action: "stop", taskId: active.id });
			return;
		}
		const document = await this.document(cwd);
		const roots = new Set(
			document.tasks
				.filter((task) => task.sourceSessionId === sessionId && isPendingCollaborationTask(task))
				.map((task) => task.rootId),
		);
		for (const rootId of roots) await this.control(cwd, { action: "stop", taskId: rootId });
	}

	private source(id: string): DesktopConversationSession {
		const session = this.sessions.get(id);
		if (!session) throw new Error("Source conversation is not an ordinary project conversation");
		return session;
	}
	async configureFromChat(sourceId: string, value: unknown): Promise<ProjectCollaborationSnapshot> {
		if (this.scheduler.active(sourceId))
			throw new Error(
				"Peer tasks cannot change project configuration; ask the user in the coordinator conversation",
			);
		return this.update(this.source(sourceId).cwd, value);
	}
	async controlFromChat(sourceId: string, value: unknown): Promise<ProjectCollaborationSnapshot> {
		if (this.scheduler.active(sourceId))
			throw new Error("Peer tasks cannot control the project; return the request to the human");
		return this.control(this.source(sourceId).cwd, value);
	}
	async inspect(sourceId: string): Promise<ProjectCollaborationSnapshot> {
		return this.read(this.source(sourceId).cwd);
	}
	async target(sourceId: string, target: string): Promise<ProjectCollaborationCandidate> {
		const cwd = this.source(sourceId).cwd;
		const all = await this.catalog().list(cwd);
		const candidates =
			target === "self"
				? all.filter((item) => item.sessionId === sourceId)
				: all.filter((item) => item.sessionId === target || item.title === target);
		if (candidates.length !== 1)
			throw new Error(
				`Conversation reference is ${candidates.length ? "ambiguous" : "not found"}; use project_collaboration_list and select an exact sessionId`,
			);
		return this.catalog().resolve(cwd, candidates[0]!.sessionId);
	}
	async history(sourceId: string, target: string, cursor = 0, limit = 20) {
		const candidate = await this.target(sourceId, target);
		const snapshot = await this.inspect(sourceId);
		if (
			!snapshot.config.enabled ||
			!snapshot.config.members.some((item) => item.sessionId === sourceId) ||
			!snapshot.config.members.some((item) => item.sessionId === candidate.sessionId)
		)
			throw new Error("History sharing is limited to participating conversations in this project");
		return this.catalog().readHistory(snapshot.cwd, candidate.sessionId, cursor, limit);
	}
	async dispatch(sourceId: string, turnId: string, input: CollaborationDispatch): Promise<ProjectCollaborationTask> {
		const source = this.source(sourceId);
		const target = await this.target(sourceId, input.target);
		if (target.sessionId === sourceId) throw new Error("Dispatch must target another conversation");
		const cwd = await this.project(source.cwd);
		const active = this.scheduler.active(sourceId);
		if (this.scheduler.isStopping(sourceId))
			throw new Error("This collaboration request is stopping; no further work can be dispatched");
		if (active?.access === "read" && input.access === "write")
			throw new Error("A read-only task cannot delegate write work; return findings to the coordinator");
		const id = randomUUID();
		let admitted: ProjectCollaborationTask | undefined;
		await this.mutate(cwd, (current) => {
			const parent = active ? collaborationScopeTask(current, active) : undefined;
			if (parent && !isPendingCollaborationTask(parent))
				throw new Error("The parent collaboration task has stopped; no further work can be dispatched");
			const next = admitCollaborationTask(current, {
				id,
				sourceId,
				targetId: target.sessionId,
				turnId,
				parent,
				input,
				now: Date.now(),
			});
			admitted = next.task;
			return next.document;
		});
		releaseCollaborationWriter(sourceId);
		log.info("collaboration request stored", {
			taskId: admitted?.id,
			status: admitted?.status,
			sourceId,
			targetId: target.sessionId,
		});
		this.scheduler.wake(cwd);
		return admitted!;
	}
	async readTask(sourceId: string, taskId: string): Promise<ProjectCollaborationTask> {
		const cwd = await this.project(this.source(sourceId).cwd);
		const snapshot = await this.document(cwd);
		if (!snapshot.config.members.some((member) => member.sessionId === sourceId))
			throw new Error("This conversation is not a collaboration member");
		const task = snapshot.tasks.find((item) => item.id === taskId);
		if (!task) throw new Error("Task not found in this project");
		if (task.sourceSessionId === sourceId && !task.deliveredToSource && !isPendingCollaborationTask(task)) {
			await this.mutate(cwd, (current) =>
				consumeCollaborationTaskResult(current, taskId, task.resultVersion ?? 0, Date.now()),
			);
		}
		return task;
	}
	async waitTasks(
		sourceId: string,
		taskIds: readonly string[],
		timeoutMs: number,
		signal: AbortSignal,
	): Promise<readonly ProjectCollaborationTask[]> {
		const source = this.source(sourceId);
		const cwd = await this.project(source.cwd);
		const read = async () => {
			const tasks = await Promise.all(taskIds.map((id) => this.readTask(sourceId, id)));
			const current = this.scheduler.active(sourceId);
			const document = await this.document(cwd);
			const ancestorSessions = new Set([sourceId]);
			let parent = current;
			while (parent?.parentId) {
				parent = document.tasks.find((item) => item.id === parent?.parentId);
				if (parent) ancestorSessions.add(parent.targetSessionId);
			}
			if (tasks.some((task) => isPendingCollaborationTask(task) && ancestorSessions.has(task.targetSessionId)))
				throw new Error(
					"Cannot wait on your own conversation or an ancestor; finish your answer so the queued work can proceed",
				);
			return tasks;
		};
		releaseCollaborationWriter(sourceId);
		signal.throwIfAborted();
		const initial = await read();
		if (!timeoutMs || initial.every((task) => !isPendingCollaborationTask(task))) return initial;
		await new Promise<void>((resolveWait, reject) => {
			let settled = false;
			const finish = (error?: unknown) => {
				if (settled) return;
				settled = true;
				unsubscribe();
				clearTimeout(timer);
				signal.removeEventListener("abort", abort);
				if (error !== undefined) reject(error);
				else resolveWait();
			};
			const abort = () => finish(signal.reason);
			const unsubscribe = this.onChanged((event) => {
				if (event.cwd === cwd) finish();
			});
			const timer = setTimeout(() => finish(), timeoutMs);
			signal.addEventListener("abort", abort, { once: true });
			if (signal.aborted) abort();
			// Close the read/subscribe gap without polling or treating timeout as failure.
			void read().then((tasks) => {
				if (
					tasks.some(
						(task, index) =>
							task.status !== initial[index]?.status || task.resultVersion !== initial[index]?.resultVersion,
					)
				)
					finish();
			}, finish);
		});
		return read();
	}
	private async execute(cwd: string, task: ProjectCollaborationTask, signal: AbortSignal): Promise<string> {
		await this.project(cwd);
		signal.throwIfAborted();
		const config = (await this.document(cwd)).config;
		const membership = config.members.find((member) => member.sessionId === task.targetSessionId);
		if (!config.enabled || !membership || (task.access === "write" && membership.access !== "write"))
			throw new Error("The target conversation no longer has the required collaboration access");
		const candidate = await this.catalog().resolve(cwd, task.targetSessionId);
		const runtime = getSharedRuntime();
		let session = this.sessions.get(candidate.sessionId);
		if (!session || runtime.getSessionPath(session.sessionId) !== candidate.path)
			session = await getDesktopConversationService().openSession(
				candidate.path,
				(await readDesktopConfig()).defaultExecutionMode ?? "sandbox",
				"interactive",
			);
		if (session.sessionId !== task.targetSessionId)
			throw new Error("Restored conversation identity does not match the collaboration target");
		setCollaborationReadOnly(session.sessionId, task.access === "read");
		try {
			const result = await getDesktopConversationService().runTurn({
				session,
				prompt: {
					text:
						task.kind === "result"
							? mainT("projectCollaborationResult", { id: task.id.slice(0, 8) })
							: `${mainT("projectCollaborationTask", { id: task.id.slice(0, 8) })}\n${task.objective.replace(/\s+/g, " ").slice(0, 240)}`,
				},
				collaborationTaskId: task.id,
				timeoutMs: null,
				signal,
			});
			return result.assistantText;
		} finally {
			if (signal.aborted) await stopSessionBackgroundWork(runtime, session.sessionId);
			finishCollaborationTurn(session.sessionId);
		}
	}
	private async complete(
		cwd: string,
		task: ProjectCollaborationTask,
		status: ProjectCollaborationTask["status"],
		text: string,
	): Promise<void> {
		const now = Date.now();
		const resultId = randomUUID();
		const updated = await this.mutate(cwd, (current) =>
			completeCollaborationTask(current, task, status, text, now, resultId),
		);
		log.info("collaboration result stored", {
			taskId: task.id,
			rootId: task.rootId,
			status: updated.tasks.find((item) => item.id === task.id)?.status,
		});
	}
}
let shared: ProjectCollaborationService | undefined;
export function getProjectCollaborationService(): ProjectCollaborationService {
	if (!shared) shared = new ProjectCollaborationService();
	return shared;
}
