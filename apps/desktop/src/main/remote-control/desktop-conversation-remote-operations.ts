import { cpus, platform, release, totalmem } from "node:os";
import type {
	CodingAgentQuestionFunctionRequest,
	CodingAgentQuestionResult,
} from "@567agent/coding-agent/function-extensions";
import {
	isCodingAgentMcpReloadStarted,
	readCodingAgentBackgroundTasksObservation,
	readCodingAgentMcpReloadFinished,
	readCodingAgentSubagentsObservation,
} from "@567agent/coding-agent/session-extensions";
import type { SessionEvent } from "@567agent/runtime-core";
import type {
	DesktopConversationService,
	DesktopConversationSession,
} from "../conversations/desktop-conversation-service.js";
import { getDesktopUserQuestionBroker } from "../conversations/user-question-broker.js";
import type {
	DesktopRemoteOperations,
	DesktopRemotePromptEvent,
	DesktopRemoteSessionSummary,
} from "./desktop-remote-connector.js";

interface ManagedSession {
	readonly session: DesktopConversationSession;
}

export interface DesktopConversationRemoteOperationsOptions {
	readonly cwd: string;
	readonly readDefaultModelKey?: () => Promise<string | undefined>;
	readonly readGeneratedImageChunk?: (
		id: string,
		offset: number,
		length: number,
	) => Promise<{
		mimeType: string;
		sizeBytes: number;
		dataBase64: string;
	} | null>;
	readonly turnTimeoutMs?: number | null;
}

class DesktopRemoteOperationError extends Error {
	constructor(
		readonly code: "SESSION_NOT_OPEN" | "MODEL_UNAVAILABLE",
		message: string,
	) {
		super(message);
	}
}

/**
 * Adapts the existing Desktop conversation ownership boundary to the remote protocol.
 * It keeps runtime session objects in process memory; only opaque IDs cross the relay.
 */
export class DesktopConversationRemoteOperations implements DesktopRemoteOperations {
	private readonly sessions = new Map<string, ManagedSession>();
	private readonly activeTurns = new Map<string, AbortController>();
	private readonly deletingSessions = new Set<string>();
	private readonly questionResolvers = new Map<string, (result: CodingAgentQuestionResult) => void>();
	private readonly turnTimeoutMs: number | null;
	readonly canReadGeneratedImages: boolean;

	constructor(
		private readonly conversations: Pick<
			DesktopConversationService,
			"createSession" | "listSessions" | "openSession" | "runTurn"
		> &
			Partial<
				Pick<
					DesktopConversationService,
					| "subscribe"
					| "readRemoteModelCatalog"
					| "readRemoteSessionHistory"
					| "hasRemoteSessionContent"
					| "selectRemoteSessionModel"
					| "replaceRemoteLastUserTurn"
					| "deleteRemoteSession"
					| "generateRemotePromptSuggestions"
					| "generateRemoteSessionTitle"
				>
			>,
		private readonly options: DesktopConversationRemoteOperationsOptions,
	) {
		this.turnTimeoutMs = options.turnTimeoutMs ?? null;
		this.canReadGeneratedImages = options.readGeneratedImageChunk !== undefined;
	}

	async listSessions(): Promise<readonly DesktopRemoteSessionSummary[]> {
		const sessions = await this.conversations.listSessions(this.options.cwd);
		return sessions.map((session) => ({
			id: session.id,
			title: session.name?.trim() || session.firstMessage,
			updatedAtEpochMs: session.modifiedAt,
		}));
	}

	async deleteSession(sessionId: string): Promise<void> {
		if (!this.conversations.deleteRemoteSession) {
			throw new Error("Desktop session deletion is unavailable");
		}
		if (this.activeTurns.has(sessionId) || this.deletingSessions.has(sessionId)) {
			throw new Error("Stop the active response before deleting this session.");
		}
		this.deletingSessions.add(sessionId);
		try {
			await this.conversations.deleteRemoteSession(sessionId, this.options.cwd);
			this.sessions.delete(sessionId);
		} finally {
			this.deletingSessions.delete(sessionId);
		}
	}

	async deleteEmptySession(sessionId: string): Promise<boolean> {
		if (!this.conversations.deleteRemoteSession) {
			throw new Error("Desktop session deletion is unavailable");
		}
		if (!this.conversations.hasRemoteSessionContent) return false;
		await this.openSession(sessionId);
		if (
			this.conversations.hasRemoteSessionContent(sessionId) ||
			this.activeTurns.has(sessionId) ||
			this.deletingSessions.has(sessionId)
		)
			return false;
		this.deletingSessions.add(sessionId);
		try {
			await this.conversations.deleteRemoteSession(sessionId, this.options.cwd);
			this.sessions.delete(sessionId);
			return true;
		} finally {
			this.deletingSessions.delete(sessionId);
		}
	}

	async createSession(): Promise<{ sessionId: string }> {
		const defaultModelKey = await this.options.readDefaultModelKey?.();
		const session = await this.conversations.createSession({ cwd: this.options.cwd }, "conversation", "interactive");
		// SessionConfig does not accept modelKey. Select after runtime initialization so
		// custom-provider defaults are applied before the session is exposed to the phone.
		if (defaultModelKey) {
			if (!this.conversations.selectRemoteSessionModel) {
				throw new DesktopRemoteOperationError("MODEL_UNAVAILABLE", "Desktop model selection is unavailable");
			}
			await this.conversations.selectRemoteSessionModel(session.sessionId, defaultModelKey);
		}
		this.sessions.set(session.sessionId, { session });
		return { sessionId: session.sessionId };
	}

	async openSession(sessionId: string): Promise<{ sessionId: string }> {
		const known = this.sessions.get(sessionId);
		if (known) return { sessionId };
		const history = await this.conversations.listSessions(this.options.cwd);
		const record = history.find((session) => session.id === sessionId);
		if (!record) throw new Error("Desktop session was not found");
		const session = await this.conversations.openSession(record.path, "sandbox", "interactive");
		this.sessions.set(session.sessionId, { session });
		return { sessionId: session.sessionId };
	}

	async readHistory(sessionId: string, offset: number, limit: number) {
		if (!this.conversations.readRemoteSessionHistory) {
			throw new DesktopRemoteOperationError("SESSION_NOT_OPEN", "Desktop session history is unavailable");
		}
		await this.openSession(sessionId);
		const session = this.sessions.get(sessionId)?.session;
		if (!session) throw new DesktopRemoteOperationError("SESSION_NOT_OPEN", "Desktop session is no longer open");
		return this.conversations.readRemoteSessionHistory(session.sessionId, offset, limit);
	}

	readModels(sessionId: string): unknown {
		if (!this.sessions.has(sessionId)) {
			throw new DesktopRemoteOperationError(
				"SESSION_NOT_OPEN",
				"Desktop session must be opened before reading its models",
			);
		}
		if (!this.conversations.readRemoteModelCatalog) {
			throw new DesktopRemoteOperationError("MODEL_UNAVAILABLE", "Desktop model selection is unavailable");
		}
		return this.conversations.readRemoteModelCatalog(sessionId);
	}

	async readGeneratedImageChunk(sessionId: string, imageId: string, offset: number, length: number) {
		if (!this.sessions.has(sessionId)) {
			throw new DesktopRemoteOperationError(
				"SESSION_NOT_OPEN",
				"Desktop session must be opened before reading images",
			);
		}
		if (!this.options.readGeneratedImageChunk) return null;
		return this.options.readGeneratedImageChunk(imageId, offset, length);
	}

	async selectModel(sessionId: string, modelKey: string): Promise<void> {
		if (!this.sessions.has(sessionId)) {
			throw new DesktopRemoteOperationError(
				"SESSION_NOT_OPEN",
				"Desktop session must be opened before selecting a model",
			);
		}
		if (!this.conversations.selectRemoteSessionModel) {
			throw new DesktopRemoteOperationError("MODEL_UNAVAILABLE", "Desktop model selection is unavailable");
		}
		await this.conversations.selectRemoteSessionModel(sessionId, modelKey);
	}

	async readSuggestions(sessionId: string, signal?: AbortSignal): Promise<readonly string[]> {
		if (!this.sessions.has(sessionId)) {
			throw new DesktopRemoteOperationError(
				"SESSION_NOT_OPEN",
				"Desktop session must be opened before reading suggestions",
			);
		}
		return (await this.conversations.generateRemotePromptSuggestions?.(sessionId, signal)) ?? [];
	}

	async *prompt(
		sessionId: string,
		text: string,
		retryPreviousTurn = false,
		retryTargetMessageId?: string,
	): AsyncIterable<DesktopRemotePromptEvent> {
		const managed = this.sessions.get(sessionId);
		if (!managed) throw new Error("Desktop session must be opened before prompting");
		if (this.activeTurns.has(sessionId) || this.deletingSessions.has(sessionId)) {
			throw new Error("Desktop session is already processing or being deleted");
		}
		const controller = new AbortController();
		this.activeTurns.set(sessionId, controller);
		try {
			if (retryPreviousTurn) {
				if (!this.conversations.replaceRemoteLastUserTurn) throw new Error("Remote retry is unavailable");
				if (retryTargetMessageId === undefined) throw new Error("Retry target is required");
				await this.conversations.replaceRemoteLastUserTurn(sessionId, retryTargetMessageId);
			}
		} catch (error) {
			this.activeTurns.delete(sessionId);
			throw error;
		}
		const queue = new AsyncPromptQueue();
		let observedTextDelta = false;
		let observedText = "";
		queue.push({ type: "state", payload: { state: "running" } });
		const hasRuntimeEvents = typeof this.conversations.subscribe === "function";
		const unsubscribe = this.conversations.subscribe?.(sessionId, (event) => {
			const mapped = mapRuntimeEvent(event, observedText);
			if (event.type === "message.delta") observedText += event.delta;
			if (event.channel === "assistant" && event.type === "text_delta") {
				observedText += event.delta;
			}
			if (mapped?.type === "delta") {
				observedTextDelta = true;
				if (
					event.type === "message.final" ||
					(event.channel === "assistant" && (event.type === "done" || event.type === "error"))
				) {
					observedText += mapped.text ?? "";
				}
			}
			if (mapped) queue.push(mapped);
		});
		const unregisterQuestion = getDesktopUserQuestionBroker().registerRemoteHandler(sessionId, async (request) => {
			queue.push({ type: "input", payload: questionPayload(request) });
			return await new Promise<CodingAgentQuestionResult>((resolve) => {
				this.questionResolvers.set(request.requestId, resolve);
			});
		});
		const turn = this.conversations
			.runTurn({
				session: managed.session,
				prompt: { text },
				timeoutMs: this.turnTimeoutMs,
				signal: controller.signal,
			})
			.then((result) => {
				void Promise.resolve()
					.then(() => this.conversations.generateRemoteSessionTitle?.(managed.session, text, result.assistantText))
					.catch(() => undefined);
				if ((!hasRuntimeEvents || !observedTextDelta) && result.assistantText) {
					queue.push({ type: "delta", text: result.assistantText });
				}
				queue.push({ type: "state", payload: { state: result.status, stopReason: result.stopReason } });
				return result;
			})
			.catch((error) => {
				throw error;
			})
			.finally(() => {
				for (const resolve of this.questionResolvers.values()) resolve({ cancelled: true, answers: [] });
				this.questionResolvers.clear();
				unsubscribe?.();
				unregisterQuestion();
				queue.close();
				this.activeTurns.delete(sessionId);
			});
		try {
			for await (const event of queue) yield event;
			await turn;
		} finally {
			controller.abort();
			await turn.catch(() => undefined);
			this.activeTurns.delete(sessionId);
		}
	}

	async abort(sessionId: string): Promise<void> {
		this.activeTurns.get(sessionId)?.abort();
	}

	async respond(sessionId: string, requestId: string, result: CodingAgentQuestionResult): Promise<void> {
		if (!this.sessions.has(sessionId)) throw new Error("Desktop session must be opened before responding");
		const resolve = this.questionResolvers.get(requestId);
		if (!resolve) throw new Error("Question request is no longer pending");
		this.questionResolvers.delete(requestId);
		resolve(result);
	}

	async resume(_sessionId: string, _lastEventSequence: number): Promise<void> {
		// Connection-level event replay is handled by RemoteConnection's ACK buffer.
	}

	async diagnostics(): Promise<Record<string, unknown>> {
		return {
			activeSessionCount: this.sessions.size,
			cwd: this.options.cwd,
			osLabel: formatOsLabel(),
			cpu: cpus()[0]?.model,
			ram: formatMemory(totalmem()),
		};
	}
}

class AsyncPromptQueue implements AsyncIterable<DesktopRemotePromptEvent> {
	private readonly values: DesktopRemotePromptEvent[] = [];
	private readonly waiters: Array<(result: IteratorResult<DesktopRemotePromptEvent>) => void> = [];
	private closed = false;

	push(value: DesktopRemotePromptEvent): void {
		const waiter = this.waiters.shift();
		if (waiter) waiter({ value, done: false });
		else this.values.push(value);
	}

	close(): void {
		this.closed = true;
		while (this.waiters.length > 0) this.waiters.shift()?.({ value: undefined, done: true });
	}

	[Symbol.asyncIterator](): AsyncIterator<DesktopRemotePromptEvent> {
		return {
			next: async () => {
				const value = this.values.shift();
				if (value) return { value, done: false };
				if (this.closed) return { value: undefined, done: true };
				return await new Promise<IteratorResult<DesktopRemotePromptEvent>>((resolve) => this.waiters.push(resolve));
			},
		};
	}
}

function mapRuntimeEvent(event: SessionEvent, observedText = ""): DesktopRemotePromptEvent | undefined {
	if (event.channel === "assistant") {
		if (event.type === "text_delta") return { type: "delta", text: event.delta };
		if (event.type === "thinking_delta") {
			return { type: "state", payload: { state: "thinking", text: event.delta } };
		}
		if (event.type === "toolcall_start" || event.type === "toolcall_delta" || event.type === "toolcall_end") {
			const call = event.partial.content[event.contentIndex];
			if (call?.type !== "toolCall") return undefined;
			return {
				type: "tool",
				payload: {
					phase: event.type === "toolcall_start" ? "generating" : "arguments",
					toolCallId: call.id,
					toolName: call.name,
					...(event.type === "toolcall_start" ? {} : { args: preview(call.arguments) }),
				},
			};
		}
		if (event.type === "done" || event.type === "error") {
			const message = event.type === "done" ? event.message : event.error;
			const text = message.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("");
			if (!text) return undefined;
			const missing = observedText && text.startsWith(observedText) ? text.slice(observedText.length) : text;
			return missing ? { type: "delta", text: missing } : undefined;
		}
		return undefined;
	}
	if (event.type === "session.extension") {
		if (isCodingAgentMcpReloadStarted(event)) return { type: "state", payload: { state: "preparing" } };
		if (readCodingAgentMcpReloadFinished(event)) return { type: "state", payload: { state: "running" } };
		const tasks = readCodingAgentBackgroundTasksObservation(event);
		if (tasks) return { type: "state", payload: { state: tasks.length > 0 ? "background" : "running" } };
		const agents = readCodingAgentSubagentsObservation(event);
		if (agents) return { type: "state", payload: { state: agents.length > 0 ? "background" : "running" } };
	}
	switch (event.type) {
		case "message.delta":
			return { type: "delta", text: event.delta };
		case "message.final": {
			if (event.message.role !== "assistant") return undefined;
			const text = event.message.content
				.filter((part): part is { type: "text"; text: string } => part.type === "text")
				.map((part) => part.text)
				.join("");
			if (!text) return undefined;
			// A turn may contain several model calls. Emit only text not already
			// delivered as deltas, while preserving providers that report per-call text.
			const missing = observedText && text.startsWith(observedText) ? text.slice(observedText.length) : text;
			return missing ? { type: "delta", text: missing } : undefined;
		}
		case "thinking.delta":
			return { type: "state", payload: { state: "thinking", text: event.delta } };
		case "toolcall.start":
			return {
				type: "tool",
				payload: { phase: "generating", toolCallId: event.toolCallId, toolName: event.toolName },
			};
		case "toolcall.args":
			return {
				type: "tool",
				payload: {
					phase: "arguments",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: preview(event.args),
				},
			};
		case "tool.start":
			return {
				type: "tool",
				payload: {
					phase: "started",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					args: preview(event.args),
				},
			};
		case "tool.update":
			return {
				type: "tool",
				payload: {
					phase: "updated",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					result: preview(event.partialResult),
				},
			};
		case "tool.phase":
			return {
				type: "tool",
				payload: { phase: "phase", toolCallId: event.toolCallId, toolName: event.toolName, label: event.label },
			};
		case "tool.end": {
			const images = event.isError ? [] : extractGeneratedImageRefs(event.result);
			return {
				type: "tool",
				payload: {
					phase: event.isError ? "failed" : "completed",
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					result: preview(event.result),
					...(images.length > 0 ? { images } : {}),
					durationMs: event.durationMs,
				},
			};
		}
		case "retry.start":
			return {
				type: "state",
				payload: { state: "retrying", attempt: event.attempt, maxAttempts: event.maxAttempts },
			};
		case "retry.end":
			return { type: "state", payload: { state: "running" } };
		case "compaction.start":
			return { type: "state", payload: { state: "compacting" } };
		case "compaction.end":
			return { type: "state", payload: { state: "running" } };
		case "usage.update":
			return {
				type: "state",
				payload: {
					state: "usage",
					input: event.input,
					output: event.output,
					total: event.input + event.output,
					contextPercent: event.contextPercent,
				},
			};
		case "session.lifecycle":
			if (event.phase === "agent_start" || event.phase === "turn_start")
				return { type: "state", payload: { state: "running" } };
			if (event.phase === "aborted") return { type: "state", payload: { state: "aborted" } };
			return undefined;
		default:
			return undefined;
	}
}

function questionPayload(request: CodingAgentQuestionFunctionRequest): Record<string, unknown> {
	return { kind: "question", requestId: request.requestId, questions: request.questions };
}

function preview(value: unknown): string {
	let text: string;
	try {
		if (typeof value === "string") {
			try {
				text = JSON.stringify(redactSensitive(JSON.parse(value)));
			} catch {
				text = value;
			}
		} else {
			text = JSON.stringify(redactSensitive(value)) ?? String(value);
		}
	} catch {
		text = String(value);
	}
	text = text
		.replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
		.replace(
			/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret)\s*[:=]\s*["']?[^\s,"'}]+/gi,
			"$1=[redacted]",
		);
	return text.length > 1_200 ? `${text.slice(0, 1_200)}…` : text;
}

function extractGeneratedImageRefs(value: unknown): Array<{ id: string; mimeType: string }> {
	let parsed: unknown = value;
	if (typeof parsed === "string") {
		const marker = /<vetta-images>([\s\S]*?)<\/vetta-images>/.exec(parsed);
		try {
			parsed = JSON.parse(marker?.[1] ?? parsed);
		} catch {
			return [];
		}
	}
	if (typeof parsed !== "object" || parsed === null) return [];
	const images = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>).images;
	if (!Array.isArray(images)) return [];
	const seen = new Set<string>();
	return images.flatMap((entry) => {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
		const { id, mimeType } = entry as Record<string, unknown>;
		if (typeof id !== "string" || !/^[a-zA-Z0-9._-]{1,128}$/.test(id) || seen.has(id)) return [];
		const safeMimeType = typeof mimeType === "string" && mimeType.startsWith("image/") ? mimeType : "image/png";
		seen.add(id);
		return [{ id, mimeType: safeMimeType }];
	});
}

function redactSensitive(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redactSensitive);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) =>
			/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|secret|cookie)/i.test(key)
				? [key, "[redacted]"]
				: [key, redactSensitive(item)],
		),
	);
}

function formatMemory(bytes: number): string {
	const gigabytes = bytes / 1024 ** 3;
	if (gigabytes >= 1) return `${gigabytes.toFixed(1)} GB`;
	return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatOsLabel(): string {
	const version = release();
	let name: string;
	switch (platform()) {
		case "win32":
			name = "Windows";
			break;
		case "darwin":
			name = "macOS";
			break;
		case "linux":
			name = "Linux";
			break;
		default:
			name = platform();
	}
	return `${name} (${version})`;
}
