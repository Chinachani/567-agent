import type { ToolPolicyRequest } from "@567agent/runtime-core/kernel";
import { collaborationToolNames } from "./tool-names.js";

interface SessionGuard {
	readonly cwd: string;
	readonly enabled: () => boolean;
}
interface Waiter {
	readonly start: () => void;
}
const sessions = new Map<string, SessionGuard>();
const readOnlyTurns = new Set<string>();
const enabledTurns = new Set<string>();
const writers = new Map<string, string>();
const waiting = new Map<string, Waiter[]>();
const READ_TOOLS = new Set([
	"read",
	"ls",
	"glob",
	"grep",
	"find",
	"tree",
	"current_time",
	"task_output",
	"web_search",
	"web_fetch",
]);

export function registerCollaborationSession(sessionId: string, cwd: string, enabled: () => boolean): void {
	sessions.set(sessionId, { cwd, enabled });
}
export function beginCollaborationTurn(sessionId: string): void {
	if (sessions.get(sessionId)?.enabled()) enabledTurns.add(sessionId);
}
export function setCollaborationReadOnly(sessionId: string, readOnly: boolean): void {
	if (readOnly) readOnlyTurns.add(sessionId);
	else readOnlyTurns.delete(sessionId);
}
function startNext(cwd: string): void {
	if (writers.has(cwd)) return;
	const queue = waiting.get(cwd);
	const next = queue?.shift();
	if (!queue?.length) waiting.delete(cwd);
	next?.start();
}
export function releaseCollaborationWriter(sessionId: string): void {
	const cwd = sessions.get(sessionId)?.cwd;
	if (!cwd || writers.get(cwd) !== sessionId) return;
	writers.delete(cwd);
	startNext(cwd);
}
export function finishCollaborationTurn(sessionId: string): void {
	readOnlyTurns.delete(sessionId);
	enabledTurns.delete(sessionId);
	releaseCollaborationWriter(sessionId);
}
export function unregisterCollaborationSession(sessionId: string): void {
	finishCollaborationTurn(sessionId);
	sessions.delete(sessionId);
}
async function acquireWriter(cwd: string, sessionId: string, signal: AbortSignal): Promise<void> {
	signal.throwIfAborted();
	if (writers.get(cwd) === sessionId) return;
	if (!writers.has(cwd)) {
		writers.set(cwd, sessionId);
		return;
	}
	await new Promise<void>((resolve, reject) => {
		const abort = () => {
			const remaining = waiting.get(cwd)?.filter((entry) => entry !== waiter);
			if (remaining?.length) waiting.set(cwd, remaining);
			else waiting.delete(cwd);
			reject(signal.reason);
			startNext(cwd);
		};
		const waiter: Waiter = {
			start: () => {
				signal.removeEventListener("abort", abort);
				if (signal.aborted) {
					reject(signal.reason);
					startNext(cwd);
					return;
				}
				writers.set(cwd, sessionId);
				resolve();
			},
		};
		signal.addEventListener("abort", abort, { once: true });
		waiting.set(cwd, [...(waiting.get(cwd) ?? []), waiter]);
		if (signal.aborted) abort();
	});
}

/** Every tool, including dynamic plugins, passes this host policy before execution. */
export async function authorizeCollaborationTool(request: ToolPolicyRequest, signal: AbortSignal): Promise<boolean> {
	signal.throwIfAborted();
	const guard = sessions.get(request.sessionId);
	if (!guard || (!guard.enabled() && ![...enabledTurns].some((id) => sessions.get(id)?.cwd === guard.cwd)))
		return true;
	if (collaborationToolNames.has(request.toolName)) return true;
	if (READ_TOOLS.has(request.toolName)) return true;
	if (readOnlyTurns.has(request.sessionId))
		throw new Error(
			"This collaboration task is read-only. Report findings or request a write task; commands, subagents and unknown plugin tools are not permitted.",
		);
	const input = request.input;
	if (
		(input && typeof input === "object" && "run_in_background" in input && input.run_in_background === true) ||
		/^(spawn_agent|dispatch_workflows|followup_task|send_message|subagent|workflow|team_delegate|team_send)$/.test(
			request.toolName,
		)
	) {
		throw new Error(
			"Project collaboration serializes changes. Use participating conversations for parallel work and foreground commands; background execution cannot retain the shared project write admission.",
		);
	}
	await acquireWriter(guard.cwd, request.sessionId, signal);
	return true;
}
