import { AI_ERROR_CODES, isAIError } from "@567agent/ai";
import type { CodingAgentQuestionResult } from "@567agent/coding-agent/function-extensions";
import type { RemoteConnection, RemoteError, RemoteRequest } from "@567agent/remote-control";

export interface DesktopRemoteSessionSummary {
	readonly id: string;
	readonly title?: string;
	readonly updatedAtEpochMs?: number;
}

export interface DesktopRemoteHistoryMessage {
	readonly id: string;
	readonly role: "user" | "assistant";
	readonly text: string;
	readonly timestamp: number;
	readonly failed?: boolean;
}

export interface DesktopRemotePromptEvent {
	readonly type: "delta" | "tool" | "input" | "state";
	readonly text?: string;
	readonly payload?: unknown;
}

export interface DesktopRemoteOperations {
	listSessions(): Promise<readonly DesktopRemoteSessionSummary[]>;
	deleteSession?(sessionId: string): Promise<void>;
	deleteEmptySession?(sessionId: string): Promise<boolean>;
	readHistory?(sessionId: string, offset: number, limit: number): Promise<readonly DesktopRemoteHistoryMessage[]>;
	readGeneratedImageChunk?(
		sessionId: string,
		imageId: string,
		offset: number,
		length: number,
	): Promise<{
		mimeType: string;
		sizeBytes: number;
		dataBase64: string;
	} | null>;
	readonly canReadGeneratedImages?: boolean;
	createSession(): Promise<{ sessionId: string }>;
	openSession(sessionId: string): Promise<{ sessionId: string }>;
	readModels?(sessionId: string): unknown;
	selectModel?(sessionId: string, modelKey: string): Promise<void>;
	readSuggestions?(sessionId: string, signal?: AbortSignal): Promise<readonly string[]>;
	prompt(
		sessionId: string,
		text: string,
		retryPreviousTurn?: boolean,
		retryTargetMessageId?: string,
	): AsyncIterable<DesktopRemotePromptEvent>;
	abort(sessionId: string): Promise<void>;
	respond?(sessionId: string, requestId: string, result: CodingAgentQuestionResult): Promise<void>;
	resume(sessionId: string, lastEventSequence: number): Promise<void>;
	diagnostics(): Promise<Record<string, unknown>>;
}

export class DesktopRemoteConnector {
	private unsubscribe: (() => void) | undefined;
	private readonly activeSuggestionRequests = new Map<string, { sessionId: string; controller: AbortController }>();

	constructor(
		private readonly connection: RemoteConnection,
		private readonly operations: DesktopRemoteOperations,
	) {}

	async start(): Promise<void> {
		this.unsubscribe = this.connection.onEvent((event) => {
			if (event.type === "remote-request") void this.handleRequest(event.request);
		});
		await this.connection.connect();
	}

	async stop(): Promise<void> {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		await this.connection.close();
	}

	private async handleRequest(request: RemoteRequest): Promise<void> {
		const suggestionController = request.method === "session.suggestions" ? new AbortController() : undefined;
		const suggestionSessionId = suggestionController ? request.sessionId : undefined;
		if (suggestionController && suggestionSessionId) {
			this.activeSuggestionRequests.set(request.requestId, {
				sessionId: suggestionSessionId,
				controller: suggestionController,
			});
		}
		try {
			const payload = await this.dispatch(request, suggestionController?.signal);
			if (suggestionController?.signal.aborted) return;
			await this.connection.respond(request.requestId, { success: true, payload });
		} catch (error) {
			if (suggestionController?.signal.aborted) return;
			await this.connection.respond(request.requestId, { success: false, error: toRemoteError(error) });
		} finally {
			if (suggestionController) this.activeSuggestionRequests.delete(request.requestId);
		}
	}

	private async dispatch(request: RemoteRequest, signal?: AbortSignal): Promise<unknown> {
		switch (request.method) {
			case "session.list":
				return {
					sessions: await this.operations.listSessions(),
					supportedMethods: [
						...(this.operations.deleteEmptySession ? ["session.delete.empty"] : []),
						...(this.operations.readSuggestions ? ["session.suggestions.cancel"] : []),
						...(this.operations.readGeneratedImageChunk && this.operations.canReadGeneratedImages !== false
							? ["session.image.read"]
							: []),
					],
				};
			case "session.delete": {
				if (!this.operations.deleteSession) throw new Error("Desktop session deletion is unavailable");
				await this.operations.deleteSession(requireSessionId(request));
				return { deleted: true };
			}
			case "session.delete.empty": {
				if (!this.operations.deleteEmptySession) throw new Error("Safe empty-session deletion is unavailable");
				return { deleted: await this.operations.deleteEmptySession(requireSessionId(request)) };
			}
			case "session.create": {
				const created = await this.operations.createSession();
				return {
					...created,
					modelCatalog: this.operations.readModels?.(created.sessionId) ?? { currentModelId: null, models: [] },
				};
			}
			case "session.open":
				return await this.operations.openSession(requireSessionId(request));
			case "session.history": {
				if (!this.operations.readHistory) throw new Error("Desktop session history is unavailable");
				const { offset, limit } = readHistoryPage(request);
				return { messages: await this.operations.readHistory(requireSessionId(request), offset, limit) };
			}
			case "session.image.read": {
				if (!this.operations.readGeneratedImageChunk) throw new Error("Desktop image transfer is unavailable");
				const { imageId, offset, length } = readImageChunkRequest(request);
				return await this.operations.readGeneratedImageChunk(requireSessionId(request), imageId, offset, length);
			}
			case "session.models":
				if (!this.operations.readModels) throw new Error("Desktop model selection is unavailable");
				return this.operations.readModels(requireSessionId(request));
			case "session.model.select": {
				const sessionId = requireSessionId(request);
				if (!this.operations.selectModel || !this.operations.readModels) {
					throw new Error("Desktop model selection is unavailable");
				}
				await this.operations.selectModel(sessionId, readModelKey(request));
				return this.operations.readModels(sessionId);
			}
			case "session.suggestions": {
				if (!this.operations.readSuggestions) throw new Error("Desktop prompt suggestions are unavailable");
				return { suggestions: await this.operations.readSuggestions(requireSessionId(request), signal) };
			}
			case "session.suggestions.cancel": {
				const payload = request.payload;
				if (
					!payload ||
					typeof payload !== "object" ||
					!("requestId" in payload) ||
					typeof payload.requestId !== "string"
				) {
					throw new Error("Suggestion cancellation target is invalid");
				}
				const sessionId = requireSessionId(request);
				const active = this.activeSuggestionRequests.get(payload.requestId);
				const matchesSession = active?.sessionId === sessionId;
				if (matchesSession && !active.controller.signal.aborted)
					active.controller.abort(new DOMException("Cancelled by mobile", "AbortError"));
				return { cancelled: Boolean(matchesSession) };
			}
			case "session.prompt": {
				const sessionId = request.sessionId
					? (await this.operations.openSession(request.sessionId)).sessionId
					: (await this.operations.createSession()).sessionId;
				const text = readPromptText(request);
				const retryPreviousTurn = readRetryPreviousTurn(request);
				const retryTargetMessageId = retryPreviousTurn ? readRetryTargetMessageId(request) : undefined;
				void this.runPrompt(sessionId, text, retryPreviousTurn, retryTargetMessageId).catch(
					async (error: unknown) => {
						if (this.connection.getSnapshot().state === "online") {
							const remoteError = toRemoteError(error);
							await this.connection.emitEvent(
								"session.state",
								{ state: "error", code: remoteError.code, message: remoteError.message },
								sessionId,
							);
						}
					},
				);
				return { accepted: true, sessionId };
			}
			case "session.abort":
				await this.operations.abort(requireSessionId(request));
				return { aborted: true };
			case "session.respond":
				if (!this.operations.respond) throw new Error("Remote question responses are unavailable");
				await this.operations.respond(
					requireSessionId(request),
					readQuestionRequestId(request),
					readQuestionResult(request),
				);
				return { responded: true };
			case "session.resume":
				await this.operations.resume(requireSessionId(request), readSequence(request));
				return { resumed: true };
			case "diagnostics.snapshot":
				return await this.operations.diagnostics();
		}
	}

	private async runPrompt(
		sessionId: string,
		text: string,
		retryPreviousTurn: boolean,
		retryTargetMessageId?: string,
	): Promise<{ completed: true; sessionId: string }> {
		for await (const event of this.operations.prompt(sessionId, text, retryPreviousTurn, retryTargetMessageId)) {
			if (event.type === "delta" && event.text) {
				await this.connection.emitEvent("session.message", { kind: "delta", text: event.text }, sessionId);
				continue;
			}
			if (event.type === "tool") {
				await this.connection.emitEvent("session.tool", event.payload, sessionId);
				continue;
			}
			if (event.type === "input") {
				await this.connection.emitEvent("session.input", event.payload, sessionId);
				continue;
			}
			await this.connection.emitEvent("session.state", event.payload, sessionId);
		}
		return { completed: true, sessionId };
	}
}

function readModelKey(request: RemoteRequest): string {
	if (!isRecord(request.payload) || typeof request.payload.modelKey !== "string" || !request.payload.modelKey) {
		throw new Error("modelKey is required");
	}
	return request.payload.modelKey;
}

function readRetryPreviousTurn(request: RemoteRequest): boolean {
	if (!isRecord(request.payload)) return false;
	if (request.payload.retryPreviousTurn === undefined) return false;
	if (typeof request.payload.retryPreviousTurn !== "boolean") throw new Error("retryPreviousTurn must be boolean");
	return request.payload.retryPreviousTurn;
}

function readRetryTargetMessageId(request: RemoteRequest): string | undefined {
	if (!isRecord(request.payload) || typeof request.payload.retryTargetMessageId !== "string") {
		throw new Error("retryTargetMessageId is required for remote retry");
	}
	if (request.payload.retryTargetMessageId.length === 0) {
		throw new Error("retryTargetMessageId must be a non-empty string");
	}
	return request.payload.retryTargetMessageId;
}

function readQuestionRequestId(request: RemoteRequest): string {
	if (!isRecord(request.payload) || typeof request.payload.requestId !== "string" || !request.payload.requestId) {
		throw new Error("question requestId is required");
	}
	return request.payload.requestId;
}

function readQuestionResult(request: RemoteRequest): CodingAgentQuestionResult {
	if (
		!isRecord(request.payload) ||
		typeof request.payload.cancelled !== "boolean" ||
		!Array.isArray(request.payload.answers)
	) {
		throw new Error("question response is invalid");
	}
	const answers = request.payload.answers
		.filter(isRecord)
		.map((answer) => ({
			question: typeof answer.question === "string" ? answer.question : "",
			answers: Array.isArray(answer.answers)
				? answer.answers.filter((value): value is string => typeof value === "string")
				: [],
		}))
		.filter((answer) => answer.question.length > 0);
	return { cancelled: request.payload.cancelled, answers };
}

function requireSessionId(request: RemoteRequest): string {
	if (!request.sessionId) throw new Error("sessionId is required");
	return request.sessionId;
}

function readHistoryPage(request: RemoteRequest): { offset: number; limit: number } {
	if (!isRecord(request.payload)) throw new Error("history page is required");
	const { offset, limit } = request.payload;
	if (!Number.isSafeInteger(offset) || (offset as number) < 0) throw new Error("history offset is invalid");
	if (!Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100) {
		throw new Error("history limit must be between 1 and 100");
	}
	return { offset: offset as number, limit: limit as number };
}

function readImageChunkRequest(request: RemoteRequest): { imageId: string; offset: number; length: number } {
	if (!isRecord(request.payload)) throw new Error("image range is required");
	const { imageId, offset, length } = request.payload;
	if (typeof imageId !== "string" || !/^[a-zA-Z0-9._-]{1,128}$/.test(imageId)) throw new Error("image id is invalid");
	if (!Number.isSafeInteger(offset) || (offset as number) < 0) throw new Error("image offset is invalid");
	if (!Number.isSafeInteger(length) || (length as number) < 1 || (length as number) > 48 * 1024) {
		throw new Error("image range length is invalid");
	}
	return { imageId, offset: offset as number, length: length as number };
}

function readPromptText(request: RemoteRequest): string {
	if (!isRecord(request.payload) || typeof request.payload.text !== "string" || !request.payload.text.trim()) {
		throw new Error("prompt payload text is required");
	}
	return request.payload.text;
}

function readSequence(request: RemoteRequest): number {
	if (!isRecord(request.payload) || typeof request.payload.lastEventSequence !== "number") {
		throw new Error("lastEventSequence is required");
	}
	return request.payload.lastEventSequence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRemoteError(error: unknown): RemoteError {
	const message = error instanceof Error ? error.message : "Remote desktop operation failed";
	if (isAIError(error)) {
		return mapModelFailure(error.code, error.retryable);
	}
	const wrappedFailure = readWrappedFailure(error);
	if (wrappedFailure) {
		return mapModelFailure(wrappedFailure.code, wrappedFailure.retryable);
	}
	const operationCode = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
	if (operationCode === "SESSION_NOT_FOUND") {
		return remoteError("not_found", "Desktop session was not found", false);
	}
	if (operationCode === "SESSION_NOT_OPEN") {
		return remoteError("not_found", "Desktop session is no longer open", false);
	}
	if (operationCode === "MODEL_UNAVAILABLE") {
		return remoteError("invalid_frame", "The selected model is no longer available", false);
	}
	if (operationCode === "STALE_RETRY_TARGET") {
		return remoteError("invalid_frame", "The desktop conversation changed; refresh it before retrying.", false);
	}
	if (operationCode === "SESSION_BUSY") {
		return remoteError("busy", "Desktop session is already processing a turn", true);
	}
	if (operationCode === "TURN_TIMEOUT") {
		return remoteError("request_timeout", "Desktop conversation turn timed out", true);
	}
	if (message.includes("not found")) {
		return remoteError("not_found", "Desktop session was not found", false);
	}
	if (message.includes("already processing")) {
		return remoteError("busy", "Desktop session is already processing a turn", true);
	}
	if (message.includes("required")) {
		return remoteError("invalid_frame", "Remote request is missing a required field", false);
	}
	return {
		code: "internal_error",
		message: "Remote desktop operation failed",
		retryable: false,
	};
}

function readWrappedFailure(error: unknown): { code: string; retryable: boolean } | undefined {
	if (!isRecord(error) || !isRecord(error.details)) return undefined;
	const { code, retryable } = error.details;
	if (typeof code !== "string" || typeof retryable !== "boolean") return undefined;
	return { code, retryable };
}

function mapModelFailure(code: string, retryable: boolean): RemoteError {
	switch (code) {
		case AI_ERROR_CODES.AUTHENTICATION_FAILED:
		case AI_ERROR_CODES.PERMISSION_DENIED:
			return remoteError("unauthorized", "Desktop model authentication failed", false);
		case AI_ERROR_CODES.MODEL_NOT_FOUND:
			return remoteError("not_found", "Desktop model is not available", false);
		case AI_ERROR_CODES.RATE_LIMITED:
			return remoteError("busy", "Desktop model is rate limited", true);
		case AI_ERROR_CODES.TIMEOUT:
			return remoteError("request_timeout", "Desktop model request timed out", true);
		case AI_ERROR_CODES.BILLING_REQUIRED:
			return remoteError("internal_error", "Desktop model billing is unavailable", false);
		default:
			return remoteError("internal_error", "Desktop model request failed", retryable);
	}
}

function remoteError(code: RemoteError["code"], message: string, retryable: boolean): RemoteError {
	return { code, message, retryable };
}
