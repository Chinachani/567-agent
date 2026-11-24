import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { LocalUsageSnapshot } from "../../shared/local-usage-log.js";
import { getSharedRuntime } from "../runtime.js";
import { getDesktopConversationService } from "./desktop-conversation-service.js";
import { listDesktopSessionSearchSources } from "./session-search-sources.js";

async function readVisibleHistory(): Promise<LocalUsageSnapshot> {
	const sessions = new Map<string, { path: string; name: string; modified: number }>();
	let partial = false;
	for (const source of await listDesktopSessionSearchSources()) {
		try {
			const items =
				source.sessions ?? (await getDesktopConversationService().listSessions(source.cwd, source.sessionDir));
			for (const item of items) {
				const access = source.sessions ? await getSharedRuntime().resolveSessionAccess(item.path) : item.access;
				if (access?.readHistory)
					sessions.set(item.path, { path: item.path, name: item.name || "", modified: item.modifiedAt });
			}
		} catch {
			partial = true;
		}
	}
	if (!sessions.size) return { rows: [], partial };
	const latest = [...sessions.values()].sort((left, right) => right.modified - left.modified).slice(0, 250);
	const snapshot = await new Promise<LocalUsageSnapshot>((done, reject) => {
		const worker = new Worker(join(dirname(fileURLToPath(import.meta.url)), "local-usage-worker.js"), {
			workerData: { sessions: latest },
			resourceLimits: { maxOldGenerationSizeMb: 384 },
		});
		const timeout = setTimeout(() => {
			void worker.terminate();
			reject(new Error("Usage log read timed out"));
		}, 60_000);
		worker.once("message", (result: LocalUsageSnapshot) => {
			clearTimeout(timeout);
			done(result);
		});
		worker.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		worker.once("exit", () => {
			clearTimeout(timeout);
			reject(new Error("Usage reader stopped"));
		});
	});
	return { rows: snapshot.rows, partial: snapshot.partial || partial || latest.length < sessions.size };
}

export function createLocalUsageReader() {
	let inFlight: Promise<LocalUsageSnapshot> | undefined;
	let lastRead = 0;
	return () => {
		if (!inFlight || Date.now() - lastRead > 30_000) {
			lastRead = Infinity;
			inFlight = readVisibleHistory().finally(() => {
				lastRead = Date.now();
			});
		}
		return inFlight;
	};
}
