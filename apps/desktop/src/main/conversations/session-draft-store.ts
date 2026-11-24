import { createHash } from "node:crypto";
import {
	chmodSync,
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import {
	REMOTE_DRAFT_MAX_CHARS,
	REMOTE_DRAFT_TOTAL_MAX_CHARS,
	type RemoteDraftTargetType,
	type RemoteSessionDraftAppendResult,
} from "@567agent/remote-control";
import type { PersistedSessionDraftMap, SessionDraftAppendedEvent } from "../../shared/session-drafts-ipc.js";
import { getAppLogger } from "../logger.js";
import { RemoteOperationError } from "../remote-control/remote-error-mapping.js";

const log = getAppLogger("session-drafts");

const DEFAULT_PATH = join(getAgent567HomePath(), "desktop-app", "session-input-drafts.json");
const STORE_VERSION = 1;
const MAX_DRAFT_ENTRIES = 200;
const MAX_APPLIED_TRANSFERS = 200;
const MAX_KEY_LENGTH = 1024;
const MAX_PEER_SCOPE_LENGTH = 256;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const MAX_LOCAL_DRAFT_CHARS = 240_000;
const LEGACY_UNSCOPED_PEER = "__legacy_unscoped__";

interface AppliedDraftTransfer {
	readonly peerScope: string;
	readonly idempotencyKey: string;
	readonly targetKey: string;
	readonly targetType: RemoteDraftTargetType;
	readonly sessionId?: string;
	readonly contentSha256?: string;
	readonly draftLength: number;
	readonly appliedAt: number;
}

interface SessionDraftStoreFile {
	readonly version: number;
	readonly lastRevision: number;
	readonly drafts: PersistedSessionDraftMap;
	readonly appliedTransfers: readonly AppliedDraftTransfer[];
}

function emptyStore(): SessionDraftStoreFile {
	return { version: STORE_VERSION, lastRevision: 0, drafts: {}, appliedTransfers: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Hex(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function writePrivateAtomicJSON(filePath: string, value: unknown): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
	const data = JSON.stringify(value, null, 2);
	const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`;
	const fd = openSync(tmpPath, "w", 0o600);
	try {
		writeSync(fd, data, undefined, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	try {
		renameSync(tmpPath, filePath);
	} catch (error) {
		if (process.platform === "win32") {
			try {
				if (existsSync(filePath)) unlinkSync(filePath);
				renameSync(tmpPath, filePath);
				return;
			} catch {
				writeFileSync(filePath, data, { encoding: "utf8", mode: 0o600 });
				try {
					if (existsSync(tmpPath)) unlinkSync(tmpPath);
				} catch {
					// Ignore temp cleanup errors on fallback write.
				}
				return;
			}
		}
		try {
			if (existsSync(tmpPath)) unlinkSync(tmpPath);
		} catch {
			// Ignore temp cleanup errors.
		}
		throw error;
	}
	if (process.platform !== "win32") {
		try {
			chmodSync(filePath, 0o600);
		} catch {
			// Best effort on POSIX filesystems.
		}
	}
}

function parseStoreFileStrict(raw: unknown): SessionDraftStoreFile {
	if (!isRecord(raw) || raw.version !== STORE_VERSION) {
		throw new Error("Unsupported or invalid session draft store format");
	}
	if (raw.drafts !== undefined && !isRecord(raw.drafts)) {
		throw new Error("Invalid drafts map in session draft store");
	}
	if (raw.appliedTransfers !== undefined && !Array.isArray(raw.appliedTransfers)) {
		throw new Error("Invalid appliedTransfers list in session draft store");
	}
	const drafts: PersistedSessionDraftMap = {};
	let maxRevision =
		typeof raw.lastRevision === "number" && Number.isSafeInteger(raw.lastRevision) && raw.lastRevision >= 0
			? raw.lastRevision
			: 0;
	if (isRecord(raw.drafts)) {
		for (const [key, entry] of Object.entries(raw.drafts)) {
			if (!key || key.length > MAX_KEY_LENGTH || !isRecord(entry)) continue;
			if (typeof entry.text !== "string" || entry.text.length === 0 || entry.text.length > MAX_LOCAL_DRAFT_CHARS)
				continue;
			const updatedAt =
				typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0;
			const revision =
				typeof entry.revision === "number" && Number.isSafeInteger(entry.revision) && entry.revision >= 1
					? entry.revision
					: 1;
			if (revision > maxRevision) maxRevision = revision;
			drafts[key] = { text: entry.text, updatedAt, revision };
		}
	}
	const appliedTransfers: AppliedDraftTransfer[] = [];
	if (Array.isArray(raw.appliedTransfers)) {
		for (const item of raw.appliedTransfers.slice(-MAX_APPLIED_TRANSFERS)) {
			if (!isRecord(item)) continue;
			if (
				typeof item.idempotencyKey !== "string" ||
				typeof item.targetKey !== "string" ||
				(item.targetType !== "new" && item.targetType !== "existing") ||
				typeof item.draftLength !== "number"
			) {
				continue;
			}
			appliedTransfers.push({
				peerScope:
					typeof item.peerScope === "string" && item.peerScope.length > 0
						? item.peerScope.slice(0, MAX_PEER_SCOPE_LENGTH)
						: LEGACY_UNSCOPED_PEER,
				idempotencyKey: item.idempotencyKey,
				targetKey: item.targetKey,
				targetType: item.targetType,
				...(typeof item.sessionId === "string" ? { sessionId: item.sessionId } : {}),
				...(typeof item.contentSha256 === "string" ? { contentSha256: item.contentSha256 } : {}),
				draftLength: item.draftLength,
				appliedAt: typeof item.appliedAt === "number" && Number.isFinite(item.appliedAt) ? item.appliedAt : 0,
			});
		}
	}
	return {
		version: STORE_VERSION,
		lastRevision: maxRevision,
		drafts,
		appliedTransfers,
	};
}

function allocateRevision(store: SessionDraftStoreFile): number {
	let maxRevision = store.lastRevision;
	for (const entry of Object.values(store.drafts)) {
		if (entry.revision > maxRevision) maxRevision = entry.revision;
	}
	return maxRevision + 1;
}

export function mergeDraftAppendText(existingText: string, appendText: string): string {
	const trimmed = appendText.trim();
	if (!trimmed) return existingText;
	if (existingText.length === 0) return trimmed;
	if (existingText.endsWith("\n\n")) return `${existingText}${trimmed}`;
	if (existingText.endsWith("\n")) return `${existingText}\n${trimmed}`;
	return `${existingText}\n\n${trimmed}`;
}

export class SessionDraftStore {
	private cache: SessionDraftStoreFile | null = null;
	private readonly listeners = new Set<(event: SessionDraftAppendedEvent) => void>();

	constructor(
		private readonly filePath = DEFAULT_PATH,
		private readonly now: () => number = Date.now,
	) {}

	onAppended(listener: (event: SessionDraftAppendedEvent) => void): () => void {
		this.listeners.add(listener);
		return () => void this.listeners.delete(listener);
	}

	listDrafts(): PersistedSessionDraftMap {
		try {
			return { ...this.readStoreStrict().drafts };
		} catch (error) {
			log.warn("session draft store is unreadable; returning empty view without overwriting", {
				error: error instanceof Error ? error.message : String(error),
			});
			return {};
		}
	}

	/**
	 * Updates an already-tracked handoff draft in place. Non-handoff local drafts
	 * are intentionally never written to disk so private/account inputs stay in RAM only.
	 */
	saveDraft(key: string, text: string, expectedRevision?: number): void {
		if (!key || key.length > MAX_KEY_LENGTH) return;
		if (text.length > MAX_LOCAL_DRAFT_CHARS) {
			throw new Error("Session draft exceeds maximum length");
		}
		let current: SessionDraftStoreFile;
		try {
			current = this.readStoreStrict();
		} catch (error) {
			log.warn("skipping local draft sync because persisted store is unreadable", {
				error: error instanceof Error ? error.message : String(error),
			});
			return;
		}
		const existing = current.drafts[key];
		if (!existing) return;
		if (expectedRevision !== undefined && existing.revision !== expectedRevision) return;
		if (text.length === 0) {
			const nextDrafts = { ...current.drafts };
			delete nextDrafts[key];
			this.commit({ ...current, drafts: nextDrafts }, false);
			return;
		}
		if (existing.text === text) return;
		const nextDrafts = {
			...current.drafts,
			[key]: { text, updatedAt: this.now(), revision: existing.revision },
		};
		this.commit({ ...current, drafts: nextDrafts }, false);
	}

	deleteDraft(key: string, expectedRevision?: number): void {
		if (!key) return;
		let current: SessionDraftStoreFile;
		try {
			current = this.readStoreStrict();
		} catch (error) {
			log.warn("skipping draft delete because persisted store is unreadable", {
				error: error instanceof Error ? error.message : String(error),
			});
			return;
		}
		const existing = current.drafts[key];
		if (!existing) return;
		if (expectedRevision !== undefined && existing.revision !== expectedRevision) return;
		const nextDrafts = { ...current.drafts };
		delete nextDrafts[key];
		this.commit({ ...current, drafts: nextDrafts }, false);
	}

	rekeyDraft(fromKey: string, toKey: string, expectedRevision?: number): number | null {
		if (!fromKey || !toKey || fromKey.length > MAX_KEY_LENGTH || toKey.length > MAX_KEY_LENGTH) return null;
		let current: SessionDraftStoreFile;
		try {
			current = this.readStoreStrict();
		} catch (error) {
			log.warn("skipping draft rekey because persisted store is unreadable", {
				error: error instanceof Error ? error.message : String(error),
			});
			return null;
		}
		const existing = current.drafts[fromKey];
		if (!existing) return null;
		if (expectedRevision !== undefined && existing.revision !== expectedRevision) return null;
		if (fromKey === toKey) return existing.revision;
		const revision = allocateRevision(current);
		const targetExisting = current.drafts[toKey]?.text ?? "";
		const merged = targetExisting ? mergeDraftAppendText(targetExisting, existing.text) : existing.text;
		if (merged.length > MAX_LOCAL_DRAFT_CHARS) {
			throw new Error("Merged session draft exceeds maximum length");
		}
		const nextDrafts = { ...current.drafts };
		delete nextDrafts[fromKey];
		nextDrafts[toKey] = { text: merged, updatedAt: this.now(), revision };
		this.commit(
			{
				...current,
				lastRevision: revision,
				drafts: nextDrafts,
			},
			false,
		);
		return revision;
	}

	clearAppliedTransfers(peerScopePrefix?: string): void {
		let current: SessionDraftStoreFile;
		try {
			current = this.readStoreStrict();
		} catch {
			return;
		}
		if (current.appliedTransfers.length === 0) return;
		const remaining = peerScopePrefix
			? current.appliedTransfers.filter((entry) => !entry.peerScope.startsWith(peerScopePrefix))
			: [];
		if (remaining.length === current.appliedTransfers.length) return;
		this.commit({ ...current, appliedTransfers: remaining }, false);
	}

	appendRemoteDraft(input: {
		readonly peerScope: string;
		readonly idempotencyKey: string;
		readonly targetKey: string;
		readonly targetType: RemoteDraftTargetType;
		readonly sessionId?: string;
		readonly sessionTitle?: string;
		readonly appendText: string;
	}): RemoteSessionDraftAppendResult {
		if (!input.peerScope || input.peerScope.length > MAX_PEER_SCOPE_LENGTH) {
			throw new RemoteOperationError("unauthorized", "远端设备身份无效，无法写入草稿", false);
		}
		if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
			throw new RemoteOperationError("invalid_frame", "草稿请求缺少有效的幂等标识", false);
		}
		if (!input.targetKey || input.targetKey.length > MAX_KEY_LENGTH) {
			throw new RemoteOperationError("invalid_frame", "目标草稿标识无效", false);
		}
		if (input.appendText.length > REMOTE_DRAFT_TOTAL_MAX_CHARS) {
			throw new RemoteOperationError("too_large", "草稿内容超出长度限制，请减少选中的消息后重试", false);
		}
		const trimmedAppend = input.appendText.trim();
		if (!trimmedAppend) {
			throw new RemoteOperationError("invalid_frame", "草稿内容不能为空", false);
		}
		if (trimmedAppend.length > REMOTE_DRAFT_MAX_CHARS) {
			throw new RemoteOperationError("too_large", "草稿内容超出长度限制，请减少选中的消息后重试", false);
		}
		const contentSha256 = sha256Hex(trimmedAppend);
		const current = this.readStoreStrict();
		const existingTransfer = current.appliedTransfers.find(
			(entry) => entry.peerScope === input.peerScope && entry.idempotencyKey === input.idempotencyKey,
		);
		if (existingTransfer) {
			const hashMismatch =
				existingTransfer.contentSha256 !== undefined && existingTransfer.contentSha256 !== contentSha256;
			if (
				existingTransfer.targetKey !== input.targetKey ||
				existingTransfer.targetType !== input.targetType ||
				existingTransfer.sessionId !== input.sessionId ||
				hashMismatch
			) {
				throw new RemoteOperationError("invalid_frame", "草稿请求标识与目标会话或内容不一致", false);
			}
			log.info("remote draft append deduplicated", {
				idempotencyKey: input.idempotencyKey,
				targetType: existingTransfer.targetType,
				sessionId: existingTransfer.sessionId,
				draftLength: existingTransfer.draftLength,
			});
			return {
				saved: true,
				deduplicated: true,
				targetType: existingTransfer.targetType,
				...(existingTransfer.sessionId ? { sessionId: existingTransfer.sessionId } : {}),
				draftLength: existingTransfer.draftLength,
			};
		}

		const baseText = current.drafts[input.targetKey]?.text ?? "";
		if (!(input.targetKey in current.drafts) && Object.keys(current.drafts).length >= MAX_DRAFT_ENTRIES) {
			throw new RemoteOperationError(
				"too_large",
				"电脑端待发送的接力草稿数量已达上限，请先发送或清理部分草稿后再试",
				false,
			);
		}
		const nextText = mergeDraftAppendText(baseText, trimmedAppend);
		if (nextText.length > REMOTE_DRAFT_TOTAL_MAX_CHARS) {
			throw new RemoteOperationError("too_large", "电脑端该会话草稿内容已达长度上限，请先清理或发送后再试", false);
		}

		const revision = allocateRevision(current);
		const record: AppliedDraftTransfer = {
			peerScope: input.peerScope,
			idempotencyKey: input.idempotencyKey,
			targetKey: input.targetKey,
			targetType: input.targetType,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
			contentSha256,
			draftLength: nextText.length,
			appliedAt: this.now(),
		};
		const nextStore: SessionDraftStoreFile = {
			version: STORE_VERSION,
			lastRevision: revision,
			drafts: {
				...current.drafts,
				[input.targetKey]: { text: nextText, updatedAt: this.now(), revision },
			},
			appliedTransfers: [...current.appliedTransfers.slice(-(MAX_APPLIED_TRANSFERS - 1)), record],
		};
		this.commit(nextStore, true);
		log.info("remote draft appended", {
			idempotencyKey: input.idempotencyKey,
			targetType: input.targetType,
			sessionId: input.sessionId,
			appendLength: trimmedAppend.length,
			draftLength: nextText.length,
			revision,
		});

		const event: SessionDraftAppendedEvent = {
			key: input.targetKey,
			appendText: trimmedAppend,
			idempotencyKey: input.idempotencyKey,
			baseText,
			nextText,
			targetType: input.targetType,
			revision,
			...(input.sessionTitle ? { sessionTitle: input.sessionTitle } : {}),
		};
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch {
				// 持久化已落盘；观察者异常不能回滚或隐藏确认结果。
			}
		}

		return {
			saved: true,
			deduplicated: false,
			targetType: input.targetType,
			...(input.sessionId ? { sessionId: input.sessionId } : {}),
			draftLength: nextText.length,
		};
	}

	private readStoreStrict(): SessionDraftStoreFile {
		if (this.cache) return this.cache;
		if (!existsSync(this.filePath)) {
			this.cache = emptyStore();
			return this.cache;
		}
		try {
			const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as unknown;
			this.cache = parseStoreFileStrict(parsed);
			return this.cache;
		} catch (error) {
			log.error("persisted session draft store is corrupted or unreadable", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw new RemoteOperationError("internal_error", "电脑端草稿存储文件已损坏，已阻止覆盖，请检查后重试", false);
		}
	}

	private commit(next: SessionDraftStoreFile, strict: boolean): void {
		try {
			writePrivateAtomicJSON(this.filePath, next);
			this.cache = next;
		} catch (error) {
			if (strict) {
				throw new RemoteOperationError("internal_error", "电脑端保存草稿失败，请检查磁盘空间或权限后重试", true);
			}
			log.warn("local draft write failed", {
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	}
}

const sharedStore = new SessionDraftStore();

export function getDesktopSessionDraftStore(): SessionDraftStore {
	return sharedStore;
}
