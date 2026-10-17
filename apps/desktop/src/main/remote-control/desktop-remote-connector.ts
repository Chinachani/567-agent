import { AI_ERROR_CODES, isAIError } from "@567agent/ai";
import type { CodingAgentQuestionResult } from "@567agent/coding-agent/function-extensions";
import type { RemoteConnection, RemoteError, RemoteRequest, RemoteSessionContext } from "@567agent/remote-control";
import { EncryptedSessionMigrationTransfer } from "./encrypted-session-migration-transfer.js";
import { RemotePromptRecovery } from "./remote-prompt-recovery.js";

const PROMPT_ATTACHMENT_CHUNK_BYTES = 192 * 1024;
const PROMPT_ATTACHMENT_MAX_BYTES = 12 * 1024 * 1024;

export interface DesktopRemoteSessionSummary {
	readonly id: string;
	readonly title?: string;
	readonly updatedAtEpochMs?: number;
}

export interface DesktopRemoteSessionCatalog {
	readonly sessions: readonly DesktopRemoteSessionSummary[];
	/** Number of configured conversation roots that could not be read. */
	readonly failedRootCount?: number;
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

export interface DesktopRemoteToolboxAbility {
	readonly slug: string;
	readonly type: "skill" | "scene" | "mcp" | "plugin" | "bundle";
	readonly name: string;
	readonly description: string;
	readonly version: string;
	readonly author: string;
	readonly category: string;
	readonly tags: readonly string[];
	readonly installable: boolean;
	readonly installed: boolean;
}

export interface DesktopRemoteOperations {
	listSessions(): Promise<readonly DesktopRemoteSessionSummary[]>;
	listSessionCatalog?(): Promise<DesktopRemoteSessionCatalog>;
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
	storeRemotePromptAttachment?(
		sessionId: string,
		fileName: string,
		mimeType: string,
		data: Buffer,
	): Promise<{ readonly kind: "file" | "image"; readonly path: string }>;
	readonly canReadGeneratedImages?: boolean;
	readonly canReceiveSessionMigration?: boolean;
	confirmSessionMigrationArchive?(encrypted: Buffer): Promise<boolean>;
	receiveEncryptedSessionMigrationArchive?(encrypted: Buffer, passphrase: string): Promise<unknown>;
	createSession(): Promise<{ sessionId: string }>;
	openSession(sessionId: string): Promise<{ sessionId: string }>;
	readonly canManageContext?: boolean;
	readonly canReadWorkbench?: boolean;
	readonly canManageCollaboration?: boolean;
	readonly canSelectContext?: boolean;
	readWorkbench?(sessionId: string): Promise<unknown>;
	readWorkbenchDetail?(sessionId: string, kind: string, id: string): Promise<unknown>;
	readCollaboration?(sessionId: string): Promise<unknown>;
	updateCollaboration?(sessionId: string, patch: unknown): Promise<unknown>;
	controlCollaboration?(sessionId: string, control: unknown): Promise<unknown>;
	readAttachmentChunk?(sessionId: string, id: string, offset: number, length: number): Promise<unknown>;
	updateContextSelection?(sessionId: string, selection: unknown): Promise<RemoteSessionContext>;
	readContext?(sessionId: string): Promise<RemoteSessionContext>;
	compactContext?(sessionId: string, signal?: AbortSignal): Promise<RemoteSessionContext & { summary: string }>;
	setAutoCompaction?(sessionId: string, enabled: boolean): Promise<RemoteSessionContext>;
	readModels?(sessionId: string): unknown;
	selectModel?(sessionId: string, modelKey: string): Promise<void>;
	readSuggestions?(sessionId: string, signal?: AbortSignal): Promise<readonly string[]>;
	readToolbox?(): Promise<readonly DesktopRemoteToolboxAbility[]>;
	installToolbox?(type: "skill" | "scene" | "plugin", slug: string): Promise<void>;
	prompt(
		sessionId: string,
		text: string,
		retryPreviousTurn?: boolean,
		retryTargetMessageId?: string,
		attachments?: {
			readonly refs: readonly { readonly kind: "file" | "image"; readonly path: string }[];
			readonly images: readonly { readonly type: "image"; readonly data: string; readonly mimeType: string }[];
		},
	): AsyncIterable<DesktopRemotePromptEvent>;
	abort(sessionId: string): Promise<void>;
	respond?(sessionId: string, requestId: string, result: CodingAgentQuestionResult): Promise<void>;
	resume(sessionId: string, lastEventSequence: number): Promise<void>;
	diagnostics(): Promise<Record<string, unknown>>;
}

export class DesktopRemoteConnector {
	private unsubscribe: (() => void) | undefined;
	private connectionGeneration = 0;
	private readonly activeAuxiliaryRequests = new Map<
		string,
		{ sessionId: string; controller: AbortController; method: RemoteRequest["method"] }
	>();
	private readonly migrationTransfer = new EncryptedSessionMigrationTransfer();
	private readonly promptAttachmentTransfer = new EncryptedSessionMigrationTransfer(
		Date.now,
		PROMPT_ATTACHMENT_CHUNK_BYTES,
	);
	private readonly activePromptAttachment = new Map<
		string,
		{ sessionId: string; fileName: string; mimeType: string }
	>();
	private readonly stagedPromptAttachments = new Map<
		string,
		{
			sessionId: string;
			ref: { readonly kind: "file" | "image"; readonly path: string };
			mimeType: string;
			dataBase64?: string;
			sizeBytes: number;
			expiresAt: number;
		}
	>();
	private readonly approvedMigrationArchives = new Map<string, { encrypted: Buffer; expiresAt: number }>();
	private readonly pendingMigrationApprovals = new Map<string, { encrypted: Buffer; cancelled: boolean }>();

	constructor(
		private readonly connection: RemoteConnection,
		private readonly operations: DesktopRemoteOperations,
		private readonly promptRecovery = new RemotePromptRecovery(),
	) {}

	async start(): Promise<void> {
		const generation = ++this.connectionGeneration;
		this.unsubscribe = this.connection.onEvent((event) => {
			if (event.type === "remote-request") {
				void this.handleRequest(event.request, generation).catch(() => undefined);
			}
		});
		await this.connection.connect();
	}

	async stop(): Promise<void> {
		this.connectionGeneration += 1;
		for (const active of this.activeAuxiliaryRequests.values()) active.controller.abort();
		this.activeAuxiliaryRequests.clear();
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.migrationTransfer.cancel();
		for (const pending of this.pendingMigrationApprovals.values()) {
			pending.cancelled = true;
			pending.encrypted.fill(0);
		}
		this.pendingMigrationApprovals.clear();
		this.promptAttachmentTransfer.cancel();
		this.activePromptAttachment.clear();
		this.clearStagedPromptAttachments();
		this.clearApprovedMigrationArchives();
		await this.connection.close();
	}

	private async handleRequest(request: RemoteRequest, generation: number): Promise<void> {
		const suggestionController =
			request.method === "session.suggestions" || request.method === "session.context.compact"
				? new AbortController()
				: undefined;
		const suggestionSessionId = suggestionController ? request.sessionId : undefined;
		if (suggestionController && suggestionSessionId) {
			this.activeAuxiliaryRequests.set(request.requestId, {
				sessionId: suggestionSessionId,
				controller: suggestionController,
				method: request.method,
			});
		}
		try {
			const payload = await this.dispatch(request, suggestionController?.signal);
			if (generation !== this.connectionGeneration || suggestionController?.signal.aborted) return;
			await this.connection.respond(request.requestId, { success: true, payload });
		} catch (error) {
			if (generation !== this.connectionGeneration || suggestionController?.signal.aborted) return;
			await this.connection.respond(request.requestId, { success: false, error: toRemoteError(error) });
		} finally {
			if (suggestionController) this.activeAuxiliaryRequests.delete(request.requestId);
		}
	}

	private async dispatch(wireRequest: RemoteRequest, signal?: AbortSignal): Promise<unknown> {
		const request = expandContextExtension(wireRequest);
		switch (request.method) {
			case "session.list": {
				const catalog = this.operations.listSessionCatalog
					? await this.operations.listSessionCatalog()
					: { sessions: await this.operations.listSessions() };
				return {
					sessions: catalog.sessions,
					...(catalog.failedRootCount ? { failedRootCount: catalog.failedRootCount } : {}),
					supportedMethods: [
						"session.create",
						"session.turn.read",
						...(this.operations.readHistory ? ["session.history"] : []),
						...(this.operations.canManageContext !== false &&
						this.operations.readContext &&
						this.operations.compactContext &&
						this.operations.setAutoCompaction
							? ["session.context", "session.context.compact", "session.context.cancel", "session.context.auto"]
							: []),
						...(this.operations.canReadWorkbench !== false &&
						this.operations.readWorkbench &&
						this.operations.readWorkbenchDetail
							? ["session.workbench", "session.workbench.detail"]
							: []),
						...(this.operations.canManageCollaboration !== false &&
						this.operations.readCollaboration &&
						this.operations.updateCollaboration &&
						this.operations.controlCollaboration
							? ["session.collaboration.read", "session.collaboration.update", "session.collaboration.control"]
							: []),
						...(this.operations.readAttachmentChunk ? ["session.attachment.read"] : []),
						...(this.operations.canSelectContext !== false && this.operations.updateContextSelection
							? ["session.context.selection"]
							: []),
						...(this.operations.readModels ? ["session.models"] : []),
						...(this.operations.readModels && this.operations.selectModel ? ["session.model.select"] : []),
						...(this.operations.readSuggestions ? ["session.suggestions"] : []),
						...(this.operations.deleteEmptySession ? ["session.delete.empty"] : []),
						...(this.operations.readSuggestions ? ["session.suggestions.cancel"] : []),
						...(this.operations.readToolbox ? ["toolbox.list"] : []),
						...(this.operations.installToolbox ? ["toolbox.install"] : []),
						...(this.operations.readGeneratedImageChunk && this.operations.canReadGeneratedImages !== false
							? ["session.image.read"]
							: []),
						...(this.operations.storeRemotePromptAttachment
							? [
									"session.attachment.transfer.start",
									"session.attachment.transfer.chunk",
									"session.attachment.transfer.finish",
									"session.attachment.transfer.cancel",
								]
							: []),
						...(this.operations.canReceiveSessionMigration &&
						this.operations.confirmSessionMigrationArchive &&
						this.operations.receiveEncryptedSessionMigrationArchive
							? [
									"session.migration.receive.start",
									"session.migration.receive.chunk",
									"session.migration.receive.finish",
									"session.migration.receive.import",
									"session.migration.receive.cancel",
								]
							: []),
					],
				};
			}
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
			case "session.attachment.transfer.start": {
				if (!this.operations.storeRemotePromptAttachment)
					throw new Error("Remote attachment transfer is unavailable");
				const sessionId = requireSessionId(request);
				const metadata = readPromptAttachmentStart(request);
				await this.operations.openSession(sessionId);
				this.promptAttachmentTransfer.start(metadata);
				this.activePromptAttachment.set(metadata.transferId, {
					sessionId,
					fileName: metadata.fileName,
					mimeType: metadata.mimeType,
				});
				return { accepted: true, nextChunkIndex: 0 };
			}
			case "session.attachment.transfer.chunk": {
				const { transferId, index, dataBase64 } = readPromptAttachmentChunk(request);
				if (this.activePromptAttachment.get(transferId)?.sessionId !== requireSessionId(request)) {
					throw new Error("Remote attachment transfer was not found for this session");
				}
				return this.promptAttachmentTransfer.append({ transferId, index, dataBase64 });
			}
			case "session.attachment.transfer.finish": {
				const transferId = readPromptAttachmentTransferId(request);
				const metadata = this.activePromptAttachment.get(transferId);
				if (
					!metadata ||
					metadata.sessionId !== requireSessionId(request) ||
					!this.operations.storeRemotePromptAttachment
				)
					throw new Error("Remote attachment transfer was not found for this session");
				const data = this.promptAttachmentTransfer.finish(transferId);
				this.activePromptAttachment.delete(transferId);
				try {
					this.pruneStagedPromptAttachments();
					const stagedBytes = [...this.stagedPromptAttachments.values()].reduce(
						(total, attachment) => total + attachment.sizeBytes,
						0,
					);
					if (this.stagedPromptAttachments.size >= 10 || stagedBytes + data.byteLength > 48 * 1024 * 1024) {
						throw new Error("Too many remote attachments are waiting to be sent");
					}
					const isImage = metadata.mimeType.toLowerCase().startsWith("image/");
					const ref = isImage
						? { kind: "image" as const, path: "" }
						: await this.operations.storeRemotePromptAttachment(
								metadata.sessionId,
								metadata.fileName,
								metadata.mimeType,
								data,
							);
					this.stagedPromptAttachments.set(transferId, {
						sessionId: metadata.sessionId,
						ref,
						mimeType: metadata.mimeType,
						...(ref.kind === "image" ? { dataBase64: data.toString("base64") } : {}),
						sizeBytes: data.byteLength,
						expiresAt: Date.now() + 10 * 60 * 1000,
					});
					return { attachmentId: transferId };
				} finally {
					data.fill(0);
				}
			}
			case "session.attachment.transfer.cancel": {
				const transferId = readOptionalPromptAttachmentTransferId(request);
				if (transferId && this.activePromptAttachment.get(transferId)?.sessionId !== requireSessionId(request)) {
					return { cancelled: false };
				}
				const cancelled = this.promptAttachmentTransfer.cancel(transferId);
				if (transferId) this.activePromptAttachment.delete(transferId);
				else this.activePromptAttachment.clear();
				return { cancelled };
			}
			case "session.migration.receive.start": {
				this.requireMigrationTransferSupport();
				this.pruneExpiredMigrationArchives();
				if (this.approvedMigrationArchives.size > 0 || this.pendingMigrationApprovals.size > 0) {
					const error = new Error(
						"电脑端仍有一个会话备份确认窗口，请先在电脑端取消或完成该窗口后，再重新发起传输",
					);
					Object.assign(error, { code: "MIGRATION_APPROVAL_PENDING" });
					throw error;
				}
				this.migrationTransfer.start(readMigrationTransferStart(request));
				return { accepted: true, nextChunkIndex: 0 };
			}
			case "session.migration.receive.chunk": {
				this.requireMigrationTransferSupport();
				return this.migrationTransfer.append(readMigrationTransferChunk(request));
			}
			case "session.migration.receive.finish": {
				this.requireMigrationTransferSupport();
				const transferId = readMigrationTransferId(request);
				const encrypted = this.migrationTransfer.finish(transferId);
				const pendingApproval = { encrypted, cancelled: false };
				this.pendingMigrationApprovals.set(transferId, pendingApproval);
				try {
					const accepted = await this.operations.confirmSessionMigrationArchive!(encrypted);
					if (this.pendingMigrationApprovals.get(transferId) !== pendingApproval || pendingApproval.cancelled) {
						return { accepted: false, cancelled: true };
					}
					if (!accepted) {
						encrypted.fill(0);
						return { accepted: false };
					}
					this.clearApprovedMigrationArchive(transferId);
					this.approvedMigrationArchives.set(transferId, { encrypted, expiresAt: Date.now() + 10 * 60 * 1000 });
					return { accepted: true };
				} catch (error) {
					encrypted.fill(0);
					throw error;
				} finally {
					if (this.pendingMigrationApprovals.get(transferId) === pendingApproval) {
						this.pendingMigrationApprovals.delete(transferId);
					}
				}
			}
			case "session.migration.receive.import": {
				this.requireMigrationTransferSupport();
				const { transferId, passphrase } = readMigrationTransferImport(request);
				const approved = this.takeApprovedMigrationArchive(transferId);
				return await this.operations.receiveEncryptedSessionMigrationArchive!(approved, passphrase);
			}
			case "session.migration.receive.cancel": {
				this.requireMigrationTransferSupport();
				const transferId = readOptionalMigrationTransferId(request);
				const transferCancelled = this.migrationTransfer.cancel(transferId);
				const pendingApprovalCancelled = transferId
					? this.cancelPendingMigrationApproval(transferId)
					: this.cancelPendingMigrationApprovals();
				const archiveCancelled = transferId
					? this.clearApprovedMigrationArchive(transferId)
					: this.clearApprovedMigrationArchives();
				return { cancelled: transferCancelled || pendingApprovalCancelled || archiveCancelled };
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
			case "session.context": {
				if (!this.operations.readContext) throw new Error("Desktop context management is unavailable");
				return this.operations.readContext(requireSessionId(request));
			}
			case "session.workbench": {
				if (!this.operations.readWorkbench) throw new Error("Desktop workbench is unavailable");
				return this.operations.readWorkbench(requireSessionId(request));
			}
			case "session.workbench.detail": {
				const payload = request.payload;
				if (
					!this.operations.readWorkbenchDetail ||
					!isRecord(payload) ||
					typeof payload.kind !== "string" ||
					typeof payload.id !== "string"
				)
					throw new Error("Invalid workbench detail request");
				return this.operations.readWorkbenchDetail(requireSessionId(request), payload.kind, payload.id);
			}
			case "session.collaboration.read": {
				if (!this.operations.readCollaboration) throw new Error("Project collaboration is unavailable");
				return this.operations.readCollaboration(requireSessionId(request));
			}
			case "session.collaboration.update": {
				if (!this.operations.updateCollaboration || !isRecord(request.payload))
					throw new Error("Invalid project collaboration update");
				return this.operations.updateCollaboration(requireSessionId(request), request.payload);
			}
			case "session.collaboration.control": {
				if (!this.operations.controlCollaboration || !isRecord(request.payload))
					throw new Error("Invalid project collaboration control");
				return this.operations.controlCollaboration(requireSessionId(request), request.payload);
			}
			case "session.attachment.read": {
				const payload = request.payload;
				if (
					!this.operations.readAttachmentChunk ||
					!isRecord(payload) ||
					typeof payload.id !== "string" ||
					typeof payload.offset !== "number" ||
					typeof payload.length !== "number"
				)
					throw new Error("Invalid attachment request");
				return this.operations.readAttachmentChunk(
					requireSessionId(request),
					payload.id,
					payload.offset,
					payload.length,
				);
			}
			case "session.context.selection": {
				if (!this.operations.updateContextSelection) throw new Error("Desktop context selection is unavailable");
				return this.operations.updateContextSelection(requireSessionId(request), request.payload);
			}
			case "session.context.compact": {
				if (!this.operations.compactContext) throw new Error("Desktop context compaction is unavailable");
				return this.operations.compactContext(requireSessionId(request), signal);
			}
			case "session.context.auto": {
				if (!this.operations.setAutoCompaction) throw new Error("Desktop context management is unavailable");
				if (!isRecord(request.payload) || typeof request.payload.enabled !== "boolean")
					throw new Error("enabled must be boolean");
				return this.operations.setAutoCompaction(requireSessionId(request), request.payload.enabled);
			}
			case "session.suggestions": {
				if (!this.operations.readSuggestions) throw new Error("Desktop prompt suggestions are unavailable");
				return { suggestions: await this.operations.readSuggestions(requireSessionId(request), signal) };
			}
			case "session.suggestions.cancel":
			case "session.context.cancel": {
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
				const active = this.activeAuxiliaryRequests.get(payload.requestId);
				const matchesSession =
					active?.sessionId === sessionId &&
					active.method ===
						(request.method === "session.context.cancel" ? "session.context.compact" : "session.suggestions");
				if (matchesSession && !active.controller.signal.aborted)
					active.controller.abort(new DOMException("Cancelled by mobile", "AbortError"));
				return { cancelled: Boolean(matchesSession) };
			}
			case "toolbox.list": {
				if (!this.operations.readToolbox) throw new Error("Desktop toolbox is unavailable");
				return { abilities: await this.operations.readToolbox() };
			}
			case "toolbox.install": {
				if (!this.operations.installToolbox) throw new Error("Desktop toolbox installation is unavailable");
				if (request.payload == null || typeof request.payload !== "object" || Array.isArray(request.payload)) {
					throw new Error("Toolbox installation details are invalid");
				}
				const payload = request.payload as Record<string, unknown>;
				if (!(["skill", "scene", "plugin"] as unknown[]).includes(payload.type)) {
					throw new Error("Only skills, scenes, and plugins can be installed from the mobile toolbox");
				}
				if (typeof payload.slug !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(payload.slug)) {
					throw new Error("Toolbox ability identifier is invalid");
				}
				await this.operations.installToolbox(payload.type as "skill" | "scene" | "plugin", payload.slug);
				return { installed: true };
			}
			case "session.prompt": {
				const sessionId = request.sessionId
					? (await this.operations.openSession(request.sessionId)).sessionId
					: (await this.operations.createSession()).sessionId;
				const turnId = readClientTurnId(request) ?? request.requestId;
				const fingerprint = this.promptRecovery.fingerprint(request.payload);
				if (this.promptRecovery.has(turnId, sessionId, fingerprint)) return { accepted: true, sessionId, turnId };
				const attachmentIds = readPromptAttachmentIds(request);
				const staged = this.takeStagedPromptAttachments(sessionId, attachmentIds);
				const text = readPromptText(request, staged.length > 0);
				const retryPreviousTurn = readRetryPreviousTurn(request);
				const retryTargetMessageId = retryPreviousTurn ? readRetryTargetMessageId(request) : undefined;
				this.promptRecovery.start(turnId, sessionId, fingerprint);
				void this.runPrompt(sessionId, text, retryPreviousTurn, retryTargetMessageId, staged, turnId)
					.catch(async (error: unknown) => {
						this.promptRecovery.fail(turnId, toRemoteError(error));
						if (this.connection.getSnapshot().state === "online") {
							const remoteError = toRemoteError(error);
							await this.connection.emitEvent(
								"session.state",
								{ state: "error", code: remoteError.code, message: remoteError.message },
								sessionId,
							);
						}
					})
					.catch(() => undefined);
				return { accepted: true, sessionId, turnId };
			}
			case "session.turn.read": {
				const sessionId = requireSessionId(request);
				const turnId = readClientTurnId(request);
				if (!turnId) throw new Error("Recovery turn identifier is required");
				await this.operations.openSession(sessionId);
				return {
					...this.promptRecovery.read(turnId, sessionId),
					eventCursor: this.connection.getOutboundEventCursor(),
				};
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
				this.promptRecovery.answered(requireSessionId(request), readQuestionRequestId(request));
				return { responded: true };
			case "session.resume":
				await this.operations.resume(requireSessionId(request), readSequence(request));
				return { resumed: true };
			case "diagnostics.snapshot":
				return await this.operations.diagnostics();
		}
	}

	private requireMigrationTransferSupport(): void {
		if (
			!this.operations.canReceiveSessionMigration ||
			!this.operations.confirmSessionMigrationArchive ||
			!this.operations.receiveEncryptedSessionMigrationArchive
		) {
			throw new Error("Encrypted conversation transfer is available only over a paired LAN connection");
		}
	}

	private cancelPendingMigrationApproval(transferId: string): boolean {
		const pending = this.pendingMigrationApprovals.get(transferId);
		if (!pending || pending.cancelled) return false;
		pending.cancelled = true;
		pending.encrypted.fill(0);
		return true;
	}

	private cancelPendingMigrationApprovals(): boolean {
		let cancelled = false;
		for (const transferId of this.pendingMigrationApprovals.keys()) {
			cancelled = this.cancelPendingMigrationApproval(transferId) || cancelled;
		}
		return cancelled;
	}

	private takeApprovedMigrationArchive(transferId: string): Buffer {
		this.pruneExpiredMigrationArchives();
		const approved = this.approvedMigrationArchives.get(transferId);
		this.approvedMigrationArchives.delete(transferId);
		if (!approved || approved.expiresAt <= Date.now()) {
			approved?.encrypted.fill(0);
			throw new Error("Desktop approval expired; start the transfer again");
		}
		return approved.encrypted;
	}

	private pruneExpiredMigrationArchives(): void {
		for (const [transferId, archive] of this.approvedMigrationArchives) {
			if (archive.expiresAt <= Date.now()) this.clearApprovedMigrationArchive(transferId);
		}
	}

	private clearApprovedMigrationArchive(transferId: string): boolean {
		const archive = this.approvedMigrationArchives.get(transferId);
		if (!archive) return false;
		archive.encrypted.fill(0);
		this.approvedMigrationArchives.delete(transferId);
		return true;
	}

	private clearApprovedMigrationArchives(): boolean {
		if (this.approvedMigrationArchives.size === 0) return false;
		for (const archive of this.approvedMigrationArchives.values()) archive.encrypted.fill(0);
		this.approvedMigrationArchives.clear();
		return true;
	}

	private async runPrompt(
		sessionId: string,
		text: string,
		retryPreviousTurn: boolean,
		retryTargetMessageId?: string,
		attachments: readonly {
			readonly id: string;
			readonly ref: { readonly kind: "file" | "image"; readonly path: string };
			readonly mimeType: string;
			readonly dataBase64?: string;
		}[] = [],
		turnId?: string,
	): Promise<{ completed: true; sessionId: string }> {
		try {
			for await (const event of this.operations.prompt(sessionId, text, retryPreviousTurn, retryTargetMessageId, {
				refs: attachments.filter(({ ref }) => ref.kind === "file").map(({ ref }) => ref),
				images: attachments.flatMap((attachment) =>
					attachment.ref.kind === "image" && attachment.dataBase64
						? [{ type: "image" as const, data: attachment.dataBase64, mimeType: attachment.mimeType }]
						: [],
				),
			})) {
				if (turnId) this.promptRecovery.record(turnId, event);
				// Keep the desktop task running during signaling loss; progress is
				// available through the turn snapshot once the phone reconnects.
				if (this.connection.getSnapshot().state !== "online") continue;
				try {
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
				} catch {
					// Socket failure is not an agent failure. Never restart the task.
				}
			}
			return { completed: true, sessionId };
		} finally {
			for (const attachment of attachments) this.stagedPromptAttachments.delete(attachment.id);
		}
	}

	private takeStagedPromptAttachments(
		sessionId: string,
		ids: readonly string[],
	): Array<{
		id: string;
		ref: { readonly kind: "file" | "image"; readonly path: string };
		mimeType: string;
		dataBase64?: string;
	}> {
		this.pruneStagedPromptAttachments();
		if (ids.length > 10 || new Set(ids).size !== ids.length) throw new Error("Remote attachment list is invalid");
		return ids.map((id) => {
			const staged = this.stagedPromptAttachments.get(id);
			if (!staged || staged.sessionId !== sessionId)
				throw new Error("Remote attachment was not found for this session");
			return { id, ...staged };
		});
	}

	private pruneStagedPromptAttachments(): void {
		for (const [id, attachment] of this.stagedPromptAttachments) {
			if (attachment.expiresAt <= Date.now()) this.stagedPromptAttachments.delete(id);
		}
	}

	private clearStagedPromptAttachments(): void {
		this.stagedPromptAttachments.clear();
	}
}

function readClientTurnId(request: RemoteRequest): string | undefined {
	if (!isRecord(request.payload) || request.payload.turnId === undefined) return undefined;
	if (typeof request.payload.turnId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(request.payload.turnId)) {
		throw new Error("Recovery turn identifier is invalid");
	}
	return request.payload.turnId;
}

function readMigrationTransferStart(request: RemoteRequest): {
	transferId: string;
	totalBytes: number;
	sha256: string;
} {
	const payload = request.payload;
	if (
		!isRecord(payload) ||
		typeof payload.transferId !== "string" ||
		typeof payload.totalBytes !== "number" ||
		typeof payload.sha256 !== "string"
	) {
		throw new Error("Conversation transfer metadata is invalid");
	}
	return { transferId: payload.transferId, totalBytes: payload.totalBytes, sha256: payload.sha256 };
}

function readMigrationTransferChunk(request: RemoteRequest): { transferId: string; index: number; dataBase64: string } {
	const payload = request.payload;
	if (
		!isRecord(payload) ||
		typeof payload.transferId !== "string" ||
		typeof payload.index !== "number" ||
		typeof payload.dataBase64 !== "string"
	) {
		throw new Error("Conversation transfer chunk is invalid");
	}
	return { transferId: payload.transferId, index: payload.index, dataBase64: payload.dataBase64 };
}

function readMigrationTransferId(request: RemoteRequest): string {
	const payload = request.payload;
	if (!isRecord(payload) || typeof payload.transferId !== "string") {
		throw new Error("Conversation transfer completion request is invalid");
	}
	return payload.transferId;
}

function readMigrationTransferImport(request: RemoteRequest): { transferId: string; passphrase: string } {
	const payload = request.payload;
	if (!isRecord(payload) || typeof payload.transferId !== "string" || typeof payload.passphrase !== "string") {
		throw new Error("Conversation transfer import request is invalid");
	}
	return { transferId: payload.transferId, passphrase: payload.passphrase };
}

function readOptionalMigrationTransferId(request: RemoteRequest): string | undefined {
	const payload = request.payload;
	if (payload === undefined) return undefined;
	if (!isRecord(payload) || typeof payload.transferId !== "string") {
		throw new Error("Conversation transfer cancellation request is invalid");
	}
	return payload.transferId;
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

function readPromptText(request: RemoteRequest, allowAttachments = false): string {
	if (
		!isRecord(request.payload) ||
		typeof request.payload.text !== "string" ||
		(!request.payload.text.trim() && !allowAttachments)
	) {
		throw new Error("prompt payload text is required");
	}
	return request.payload.text;
}

function readPromptAttachmentStart(request: RemoteRequest): {
	transferId: string;
	fileName: string;
	mimeType: string;
	totalBytes: number;
	sha256: string;
} {
	const payload = request.payload;
	if (
		!isRecord(payload) ||
		typeof payload.transferId !== "string" ||
		typeof payload.fileName !== "string" ||
		typeof payload.mimeType !== "string" ||
		typeof payload.totalBytes !== "number" ||
		typeof payload.sha256 !== "string"
	)
		throw new Error("Remote attachment metadata is invalid");
	const fileName = payload.fileName
		.replace(/[/\\\r\n\0]/g, "_")
		.trim()
		.slice(0, 180);
	if (!fileName || fileName === "." || fileName === "..") throw new Error("Remote attachment filename is invalid");
	if (!/^[A-Za-z0-9][A-Za-z0-9.+-]{0,126}\/[A-Za-z0-9][A-Za-z0-9.+-]{0,126}$/.test(payload.mimeType)) {
		throw new Error("Remote attachment type is not supported");
	}
	if (!/^[A-Za-z0-9_-]{16,128}$/.test(payload.transferId)) throw new Error("Remote attachment transfer id is invalid");
	if (
		!Number.isSafeInteger(payload.totalBytes) ||
		payload.totalBytes < 1 ||
		payload.totalBytes > PROMPT_ATTACHMENT_MAX_BYTES
	) {
		throw new Error("Remote attachment exceeds the 12 MB limit");
	}
	return {
		transferId: payload.transferId,
		fileName,
		mimeType: payload.mimeType,
		totalBytes: payload.totalBytes,
		sha256: payload.sha256,
	};
}

function readPromptAttachmentChunk(request: RemoteRequest): { transferId: string; index: number; dataBase64: string } {
	const payload = request.payload;
	if (
		!isRecord(payload) ||
		typeof payload.transferId !== "string" ||
		typeof payload.index !== "number" ||
		typeof payload.dataBase64 !== "string"
	) {
		throw new Error("Remote attachment chunk is invalid");
	}
	return { transferId: payload.transferId, index: payload.index, dataBase64: payload.dataBase64 };
}

function readPromptAttachmentTransferId(request: RemoteRequest): string {
	if (!isRecord(request.payload) || typeof request.payload.transferId !== "string") {
		throw new Error("Remote attachment transfer id is required");
	}
	return request.payload.transferId;
}

function readOptionalPromptAttachmentTransferId(request: RemoteRequest): string | undefined {
	if (request.payload === undefined) return undefined;
	return readPromptAttachmentTransferId(request);
}

function readPromptAttachmentIds(request: RemoteRequest): string[] {
	if (!isRecord(request.payload) || request.payload.attachmentIds === undefined) return [];
	if (
		!Array.isArray(request.payload.attachmentIds) ||
		request.payload.attachmentIds.some((id) => typeof id !== "string")
	) {
		throw new Error("Remote attachment references are invalid");
	}
	return request.payload.attachmentIds as string[];
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
	const message = error instanceof Error ? error.message : "电脑端操作失败";
	if (isAIError(error)) {
		return mapModelFailure(error.code, error.retryable);
	}
	const wrappedFailure = readWrappedFailure(error);
	if (wrappedFailure) {
		return mapModelFailure(wrappedFailure.code, wrappedFailure.retryable);
	}
	const operationCode = isRecord(error) && typeof error.code === "string" ? error.code : undefined;
	if (operationCode === "SESSION_MIGRATION_IMPORT_FAILED") {
		return remoteError("internal_error", `电脑端导入会话备份失败：${message.slice(0, 500)}`, false);
	}
	if (operationCode === "SESSION_ROOTS_UNAVAILABLE") {
		return remoteError("internal_error", "无法读取电脑端会话目录，请检查应用对会话目录的访问权限后重试", true);
	}
	if (operationCode === "MIGRATION_APPROVAL_PENDING") {
		return remoteError("busy", message, true);
	}
	if (operationCode === "SESSION_NOT_FOUND") {
		return remoteError("not_found", "找不到这条电脑端会话", false);
	}
	if (operationCode === "SESSION_NOT_OPEN") {
		return remoteError("not_found", "这条电脑端会话已关闭，请刷新列表后重试", false);
	}
	if (operationCode === "MODEL_UNAVAILABLE") {
		return remoteError("invalid_frame", "当前选择的模型已不可用，请在电脑端重新选择模型", false);
	}
	if (operationCode === "STALE_RETRY_TARGET") {
		return remoteError("invalid_frame", "电脑端会话内容已变化，请刷新会话后再重试", false);
	}
	if (operationCode === "SESSION_BUSY") {
		return remoteError("busy", "电脑端正在处理这条会话，请稍后重试", true);
	}
	if (operationCode === "TURN_TIMEOUT") {
		return remoteError("request_timeout", "电脑端处理超时，请检查连接后重试", true);
	}
	if (message.includes("not found") || message.includes("does not exist")) {
		return remoteError("not_found", "找不到这条电脑端会话，请刷新列表后重试", false);
	}
	if (message.includes("already processing") || message.includes("正在处理")) {
		return remoteError("busy", "电脑端正在处理这条会话，请稍后重试", true);
	}
	if (message.includes("required") || message.includes("is required")) {
		return remoteError("invalid_frame", "远程请求缺少必要信息，请更新电脑端后重试", false);
	}
	return {
		code: "internal_error",
		message: /EACCES|EPERM|permission denied|access denied|权限不足|无权访问/i.test(message)
			? "电脑端无权访问所需目录，请检查目录权限后重试"
			: "电脑端操作失败，请重试；若持续失败，请检查电脑端日志",
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
			return remoteError("unauthorized", "电脑端模型认证失败，请检查默认模型和 API 密钥", false);
		case AI_ERROR_CODES.MODEL_NOT_FOUND:
			return remoteError("not_found", "电脑端选择的模型已不可用，请重新选择模型", false);
		case AI_ERROR_CODES.RATE_LIMITED:
			return remoteError("busy", "电脑端模型请求过于频繁，请稍后重试", true);
		case AI_ERROR_CODES.TIMEOUT:
			return remoteError("request_timeout", "电脑端模型请求超时，请检查网络后重试", true);
		case AI_ERROR_CODES.BILLING_REQUIRED:
			return remoteError("internal_error", "电脑端模型额度不可用，请检查账户或服务配置", false);
		default:
			return remoteError("internal_error", "电脑端模型请求失败，请检查模型配置和运行日志", retryable);
	}
}

function remoteError(code: RemoteError["code"], message: string, retryable: boolean): RemoteError {
	return { code, message, retryable };
}

/** Optional session features travel inside an established frame so older blind relays keep working. */
function expandContextExtension(request: RemoteRequest): RemoteRequest {
	if (
		request.method !== "session.context" ||
		!isRecord(request.payload) ||
		request.payload.extensionMethod === undefined
	)
		return request;
	const method = request.payload.extensionMethod;
	if (
		method !== "session.context.selection" &&
		method !== "session.workbench" &&
		method !== "session.workbench.detail" &&
		method !== "session.collaboration.read" &&
		method !== "session.collaboration.update" &&
		method !== "session.collaboration.control" &&
		method !== "session.attachment.read"
	)
		throw new Error("Unknown session context extension");
	return { ...request, method, payload: request.payload.payload };
}
