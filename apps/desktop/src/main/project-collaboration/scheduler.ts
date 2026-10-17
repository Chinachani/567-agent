import type { ProjectCollaborationDocument, ProjectCollaborationTask } from "../../shared/project-collaboration.js";
import { getAppLogger } from "../logger.js";

import { canRunCollaborationTask } from "./task-state.js";

const log = getAppLogger("project-collaboration");
export interface CollaborationSchedulerPort {
	read(cwd: string): Promise<ProjectCollaborationDocument>;
	mutate(
		cwd: string,
		edit: (document: ProjectCollaborationDocument) => ProjectCollaborationDocument,
	): Promise<ProjectCollaborationDocument>;
	isBusy(sessionId: string): boolean;
	settled(cwd: string): void;
	execute(cwd: string, task: ProjectCollaborationTask, signal: AbortSignal): Promise<string>;
	complete(
		cwd: string,
		task: ProjectCollaborationTask,
		status: ProjectCollaborationTask["status"],
		result: string,
	): Promise<void>;
}
class ManualTurnInterruption extends Error {}
interface RunningTask {
	readonly cwd: string;
	readonly task: ProjectCollaborationTask;
	readonly abort: AbortController;
	readonly settled: Promise<void>;
}

/** Admission is durable before a model starts; cancellation waits for the actual runner to settle. */
export class CollaborationScheduler {
	private readonly running = new Map<string, RunningTask>();
	private readonly manual = new Map<string, number>();
	private readonly draining = new Set<string>();
	private readonly requested = new Set<string>();
	constructor(private readonly port: CollaborationSchedulerPort) {}
	isStopping(sessionId: string): boolean {
		return this.running.get(sessionId)?.abort.signal.aborted ?? false;
	}
	active(sessionId: string): ProjectCollaborationTask | undefined {
		return this.running.get(sessionId)?.task;
	}
	isEngaged(sessionId: string): boolean {
		return this.running.has(sessionId) || this.manual.has(sessionId);
	}
	activeTasks(cwd: string): readonly ProjectCollaborationTask[] {
		return [...this.running.values()].filter((item) => item.cwd === cwd).map((item) => item.task);
	}
	async withManual<T>(sessionId: string, run: () => Promise<T>): Promise<T> {
		this.manual.set(sessionId, (this.manual.get(sessionId) ?? 0) + 1);
		try {
			const active = this.running.get(sessionId);
			active?.abort.abort(
				new ManualTurnInterruption(
					"Collaboration interrupted by a direct user message; continue explicitly after inspecting the conversation",
				),
			);
			await active?.settled;
			return await run();
		} finally {
			const count = (this.manual.get(sessionId) ?? 1) - 1;
			if (count) this.manual.set(sessionId, count);
			else this.manual.delete(sessionId);
		}
	}
	wake(cwd: string): void {
		if (this.draining.has(cwd)) {
			this.requested.add(cwd);
			return;
		}
		this.draining.add(cwd);
		void this.drain(cwd)
			.catch((error) => log.error("collaboration admission failed", error))
			.finally(() => {
				this.draining.delete(cwd);
				if (this.requested.delete(cwd)) this.wake(cwd);
			});
	}
	private async drain(cwd: string): Promise<void> {
		for (;;) {
			const document = await this.port.read(cwd);
			if (!document.config.enabled || document.config.paused) return;
			const active = [...this.running.values()].filter((item) => item.cwd === cwd);
			if (active.length >= 3) return;
			const task = document.tasks.find(
				(item) =>
					item.status === "queued" &&
					canRunCollaborationTask(document, item) &&
					!this.running.has(item.targetSessionId) &&
					!this.manual.has(item.targetSessionId) &&
					!this.port.isBusy(item.targetSessionId) &&
					(item.access === "read" || !active.some((run) => run.task.access === "write")),
			);
			if (!task) return;
			const abort = new AbortController();
			let release: () => void = () => {};
			const settled = new Promise<void>((resolve) => {
				release = resolve;
			});
			this.running.set(task.targetSessionId, { cwd, task, abort, settled });
			try {
				const next = await this.port.mutate(cwd, (current) => {
					if (
						current.config.paused ||
						!current.config.enabled ||
						current.tasks.find((entry) => entry.id === task.id)?.status !== "queued"
					)
						return current;
					return {
						...current,
						tasks: current.tasks.map((entry) =>
							entry.id === task.id
								? { ...entry, status: "running", startedAt: entry.startedAt ?? Date.now() }
								: entry,
						),
					};
				});
				const admitted = next.tasks.find((item) => item.id === task.id);
				if (admitted?.status !== "running") {
					this.running.delete(task.targetSessionId);
					release();
					return;
				}
				log.info("collaboration task started", {
					taskId: task.id,
					rootId: task.rootId,
					targetId: task.targetSessionId,
					access: task.access,
				});
				void this.run(cwd, admitted, abort)
					.finally(() => {
						this.running.delete(task.targetSessionId);
						release();
						this.port.settled(cwd);
						queueMicrotask(() => this.wake(cwd));
					})
					.catch((error) => log.error("collaboration completion could not be persisted", error));
			} catch (error) {
				this.running.delete(task.targetSessionId);
				release();
				throw error;
			}
		}
	}
	private async run(cwd: string, task: ProjectCollaborationTask, abort: AbortController): Promise<void> {
		let status: ProjectCollaborationTask["status"] = "completed";
		let result: string;
		try {
			abort.signal.throwIfAborted();
			result = await this.port.execute(cwd, task, abort.signal);
			if (abort.signal.aborted)
				status = abort.signal.reason instanceof ManualTurnInterruption ? "interrupted" : "cancelled";
		} catch (error) {
			result = error instanceof Error ? error.message : String(error);
			status =
				abort.signal.reason instanceof ManualTurnInterruption
					? "interrupted"
					: abort.signal.aborted
						? "cancelled"
						: "failed";
			log.warn("collaboration task ended", { taskId: task.id, status, error: result });
		}
		// A persistence failure must not turn successful paid work into a second execution.
		await this.port.complete(cwd, task, status, result);
	}

	async stop(cwd: string, taskIds?: ReadonlySet<string>): Promise<void> {
		const targets = [...this.running.values()].filter(
			(item) => item.cwd === cwd && (!taskIds || taskIds.has(item.task.id)),
		);
		for (const item of targets) item.abort.abort(new Error("Collaboration stopped by user"));
		await Promise.allSettled(targets.map((item) => item.settled));
	}
}
