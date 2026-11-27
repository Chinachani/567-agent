import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { FileConversationRepository } from "@567agent/runtime-node/conversation";
import { atomicWriteJSONAsync } from "@567agent/toolkit/atomic-write";
import { createVersionedJsonConfigStore } from "@567agent/toolkit/config-store";
import { z } from "zod";
import type { DesktopTaskResult, ResultInboxSnapshot, TaskResult } from "../../shared/result-inbox.js";
import { resolveDesktopSessionOpenTarget } from "../../shared/session-access.js";
import { getDesktopConversationService } from "../conversations/desktop-conversation-service.js";
import { resolveDesktopRuntimeSessionRoots } from "../conversations/session-catalog-roots.js";
import { peekSharedRuntime } from "../runtime.js";
import { projectTaskResults } from "./task-results.js";

const ledgerSchema = z.object({ schemaVersion: z.literal(1), read: z.record(z.string().max(80), z.string().max(120)) });
const ledger = createVersionedJsonConfigStore({
	path: join(getAgent567HomePath(), "result-inbox.json"),
	name: "result-inbox",
	readErrorPolicy: "throw",
	normalize: (value: unknown) => ledgerSchema.parse(value ?? { schemaVersion: 1, read: {} }),
	writeJson: atomicWriteJSONAsync,
});
const cache = new Map<string, { stamp: string; tasks: TaskResult[] }>();
let flight: Promise<ResultInboxSnapshot> | null = null;
let writeQueue: Promise<void> = Promise.resolve();
const fingerprint = (task: TaskResult) => `${task.status}:${task.endedAt ?? "open"}`;

export function listResultInbox(): Promise<ResultInboxSnapshot> {
	if (!flight)
		flight = readInbox().finally(() => {
			flight = null;
		});
	return flight;
}

async function readInbox(): Promise<ResultInboxSnapshot> {
	const reads = (await ledger.read()).read;
	let unavailableCount = 0;
	const located = [];
	for (const root of resolveDesktopRuntimeSessionRoots()) {
		try {
			const sessions = await getDesktopConversationService().listSessions(root.cwd, root.sessionDir);
			located.push(...sessions.map((session) => ({ ...session, cwd: root.cwd })));
		} catch {
			unavailableCount++;
		}
	}
	const unique = [...new Map(located.map((session) => [session.path, session])).values()].sort(
		(a, b) => b.modifiedAt - a.modifiedAt,
	);
	const selected = unique.slice(0, 200);
	const results: DesktopTaskResult[] = [];
	const livePaths = new Set(selected.map((item) => item.path));
	for (const path of cache.keys()) if (!livePaths.has(path)) cache.delete(path);
	let bytesRead = 0;
	const deadline = Date.now() + 15_000;
	for (const session of selected) {
		const openTarget = resolveDesktopSessionOpenTarget(session.access);
		if (openTarget === "unavailable" || !session.access.readHistory) continue;
		// Legacy JSONL has no reliable terminal journal. Never infer success from modifiedAt.
		if (!session.path.endsWith(".conversation.jsonl")) continue;
		try {
			const info = await stat(session.path);
			if (info.size > 16 * 1024 * 1024 || bytesRead + info.size > 64 * 1024 * 1024 || Date.now() > deadline) {
				unavailableCount++;
				continue;
			}
			const stamp = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
			let tasks = cache.get(session.path)?.stamp === stamp ? cache.get(session.path)?.tasks : undefined;
			if (!tasks) {
				bytesRead += info.size;
				const repository = new FileConversationRepository({ rootDir: dirname(session.path) });
				try {
					if (resolve(repository.resolveConversationPath(session.id)) !== resolve(session.path)) continue;
					const { conversation, document } = await repository.readSnapshot(session.id, {
						maxBytes: 16 * 1024 * 1024,
					});
					const after = await stat(session.path);
					if (`${after.mtimeMs}:${after.ctimeMs}:${after.size}` !== stamp) {
						unavailableCount++;
						continue;
					}
					tasks = projectTaskResults(conversation, document).slice(-200);
					cache.set(session.path, { stamp, tasks });
				} finally {
					await repository.close();
				}
			}
			const running = peekSharedRuntime()?.getRunningSessionPaths().includes(session.path) ?? false;
			for (const [index, task] of tasks.entries()) {
				// Runtime may be between a failed attempt and its retry journal entry.
				if (running && index === tasks.length - 1 && !task.open && task.status !== "completed") continue;
				const current =
					running && index === tasks.length - 1 && task.open
						? { ...task, status: "running" as const, open: true, endedAt: undefined }
						: task;
				const key = createHash("sha256").update(`${session.path}\0${task.taskId}`).digest("hex");
				results.push({
					...current,
					key,
					sessionPath: session.path,
					cwd: session.cwd,
					title: (session.name?.trim() || session.firstMessage || "").slice(0, 300),
					read: reads[key] === fingerprint(current),
					openTarget,
				});
			}
		} catch {
			unavailableCount++;
		}
	}
	results.sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt));
	return { tasks: results.slice(0, 200), unavailableCount, truncated: unique.length > 200 || results.length > 200 };
}

export function markResultRead(key: string): Promise<void> {
	const operation = writeQueue.then(async () => {
		const snapshot = await listResultInbox();
		const task = snapshot.tasks.find((item) => item.key === key);
		if (!task) return;
		const previous = await ledger.read();
		const read = Object.fromEntries(
			Object.entries(previous.read)
				.filter(([id]) => id !== key)
				.slice(-999),
		);
		read[key] = fingerprint(task);
		await ledger.write({ schemaVersion: 1, read });
	});
	writeQueue = operation.catch(() => {});
	return operation;
}

/** Remote peers receive opaque identities, never host file paths or private error details. */
export async function listRemoteTaskResults() {
	const snapshot = await listResultInbox();
	return {
		tasks: snapshot.tasks.map(({ sessionId, taskId, title, startedAt, endedAt, status, open }) => ({
			sessionId,
			taskId,
			title,
			startedAt,
			endedAt,
			status,
			open,
		})),
		unavailableCount: snapshot.unavailableCount,
		truncated: snapshot.truncated,
	};
}
