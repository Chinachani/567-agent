import { stat } from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { CompositeRuntimeSessionFileHistoryReader } from "@567agent/runtime-core";
import { createDesktopHistoricalSessionFormat } from "@567agent/runtime-desktop";
import { FileConversationRuntimeSessionFileHistoryReader } from "@567agent/runtime-node/conversation";
import type { LocalUsageRow, LocalUsageSnapshot } from "../shared/local-usage-log.js";

const sessions: { path: string; name: string }[] = workerData.sessions;
const reader = new CompositeRuntimeSessionFileHistoryReader([
	createDesktopHistoricalSessionFormat().sessionFileHistoryReader,
	new FileConversationRuntimeSessionFileHistoryReader(),
]);

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

async function collect(): Promise<LocalUsageSnapshot> {
	const rows: LocalUsageRow[] = [];
	let partial = false;
	let bytes = 0;
	for (const session of sessions) {
		try {
			const info = await stat(session.path);
			if (!info.isFile() || info.size > 16 * 1024 ** 2 || bytes + info.size > 128 * 1024 ** 2) {
				partial = true;
				continue;
			}
			bytes += info.size;
			const history = reader.read(session.path).history;
			for (let index = history.length - 1; index >= 0; index--) {
				const entry = history[index];
				const common = {
					id: `${session.path}:${entry.type === "message" || entry.type === "error" ? entry.entryId || index : index}`,
					sessionName: session.name,
					sessionId: session.path,
				};
				if (entry.type === "message" && entry.message.role === "assistant") {
					const message = entry.message;
					const usage = message.usage;
					if (!Number.isFinite(message.timestamp)) {
						partial = true;
						continue;
					}
					const total = count(usage?.totalTokens);
					const parts = [usage?.input, usage?.output, usage?.cacheRead, usage?.cacheWrite];
					const observed = (total ?? 0) > 0 || parts.some((value) => (count(value) ?? 0) > 0);
					rows.push({
						...common,
						timestamp: message.timestamp,
						provider: message.provider ?? "",
						model: message.model ?? "",
						input: observed ? count(usage?.input) : undefined,
						output: observed ? count(usage?.output) : undefined,
						cacheRead:
							usage?.cacheUsageReporting === "read-only" ||
							usage?.cacheUsageReporting === "read-write" ||
							usage?.cacheRead > 0
								? count(usage.cacheRead)
								: undefined,
						cacheWrite:
							usage?.cacheUsageReporting === "read-write" || usage?.cacheWrite > 0
								? count(usage.cacheWrite)
								: undefined,
						total: observed
							? total ||
								(parts.every((value) => count(value) !== undefined)
									? parts.reduce((sum, value) => sum + value, 0)
									: undefined)
							: undefined,
						durationMs: count(usage?.performance?.durationMs),
						firstTextMs: count(usage?.performance?.firstTextMs),
						status:
							message.stopReason === "error"
								? "error"
								: message.stopReason === "aborted"
									? "aborted"
									: "success",
					});
				} else if (entry.type === "error" && entry.origin === "provider") {
					const previous = history[index - 1];
					if (
						previous?.type === "message" &&
						previous.message.role === "assistant" &&
						previous.message.stopReason === "error"
					)
						continue;
					const timestamp = Date.parse(entry.timestamp);
					if (Number.isFinite(timestamp))
						rows.push({
							...common,
							timestamp,
							model: entry.details?.modelId ?? "",
							provider: entry.details?.provider ?? "",
							status: "error",
						});
				}
				if (rows.length >= 5000) return { rows, partial: true };
			}
		} catch {
			partial = true;
		}
	}
	return { rows, partial };
}

void collect().then((snapshot) => parentPort?.postMessage(snapshot));
