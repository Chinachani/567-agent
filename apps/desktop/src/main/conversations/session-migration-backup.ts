import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "node:crypto";

export const SESSION_MIGRATION_MAX_BYTES = 200 * 1024 * 1024;
const MAGIC = Buffer.from("567CHATBACKUP1", "ascii");
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const PBKDF2_ITERATIONS = 600_000;

export interface SessionMigrationArchive {
	readonly schemaVersion: 1;
	readonly exportedAtEpochMs: number;
	readonly sessions: readonly SessionMigrationSession[];
	readonly messages: readonly SessionMigrationMessageGroup[];
}

export interface SessionMigrationSession {
	readonly id: string;
	readonly title: string;
	readonly modelId?: string | null;
	readonly modelName?: string | null;
	readonly createdAtEpochMs: number;
	readonly updatedAtEpochMs: number;
	readonly pinned?: boolean;
	readonly origin?: string;
	readonly remoteDeviceId?: string | null;
	readonly remoteSessionId?: string | null;
	readonly remoteSessionCreatedOnMobile?: boolean;
	readonly titleManuallyEdited?: boolean;
}

export interface SessionMigrationMessageGroup {
	readonly sessionId: string;
	readonly items: readonly SessionMigrationMessage[];
}

export interface SessionMigrationMessage {
	readonly id: string;
	readonly sessionId: string;
	readonly role: "system" | "user" | "assistant";
	readonly content: string;
	readonly status: "Pending" | "Streaming" | "Complete" | "Error" | "Aborted";
	readonly createdAtEpochMs: number;
	readonly errorMessage?: string | null;
	readonly images?: readonly SessionMigrationImage[];
	readonly toolEvents?: readonly SessionMigrationToolEvent[];
	readonly usage?: {
		readonly promptTokens?: number | null;
		readonly completionTokens?: number | null;
		readonly totalTokens?: number | null;
	} | null;
	readonly contextPercent?: number | null;
	readonly pendingQuestion?: unknown;
}

export interface SessionMigrationImage {
	readonly id: string;
	readonly mimeType: string;
	readonly fileName?: string | null;
	readonly base64Data?: string | null;
	readonly storageKey?: string | null;
}

export interface SessionMigrationToolEvent {
	readonly phase: string;
	readonly toolCallId: string;
	readonly toolName: string;
	readonly detail?: string | null;
	readonly durationMs?: number | null;
	readonly arguments?: string | null;
	readonly result?: string | null;
	readonly phaseLabel?: string | null;
}

export function encryptSessionMigrationArchive(plaintext: Uint8Array, passphrase: string): Buffer {
	assertPassphrase(passphrase);
	if (plaintext.byteLength > SESSION_MIGRATION_MAX_BYTES) throw new Error("Migration archive is too large");
	const salt = randomBytes(SALT_BYTES);
	const nonce = randomBytes(NONCE_BYTES);
	const key = deriveKey(passphrase, salt);
	try {
		const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
		const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
		const archive = Buffer.concat([MAGIC, salt, nonce, encrypted]);
		if (archive.byteLength > SESSION_MIGRATION_MAX_BYTES) throw new Error("Migration archive is too large");
		return archive;
	} finally {
		key.fill(0);
	}
}

export function decryptSessionMigrationArchive(archive: Uint8Array, passphrase: string): Buffer {
	assertPassphrase(passphrase);
	if (archive.byteLength > SESSION_MIGRATION_MAX_BYTES) throw new Error("Migration archive is too large");
	const input = Buffer.from(archive);
	const headerLength = MAGIC.byteLength + SALT_BYTES + NONCE_BYTES;
	if (input.byteLength <= headerLength + TAG_BYTES || !input.subarray(0, MAGIC.byteLength).equals(MAGIC)) {
		throw new Error("This is not a supported 567 Agent migration backup");
	}
	const saltStart = MAGIC.byteLength;
	const salt = input.subarray(saltStart, saltStart + SALT_BYTES);
	const nonceStart = saltStart + SALT_BYTES;
	const nonce = input.subarray(nonceStart, nonceStart + NONCE_BYTES);
	const ciphertext = input.subarray(headerLength, input.byteLength - TAG_BYTES);
	const tag = input.subarray(input.byteLength - TAG_BYTES);
	const key = deriveKey(passphrase, salt);
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: TAG_BYTES });
		decipher.setAuthTag(tag);
		const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
		if (plaintext.byteLength > SESSION_MIGRATION_MAX_BYTES) {
			plaintext.fill(0);
			throw new Error("Migration archive is too large");
		}
		return plaintext;
	} catch (error) {
		throw new Error("The password is incorrect or the migration backup is damaged", { cause: error });
	} finally {
		key.fill(0);
	}
}

export function parseSessionMigrationArchive(plaintext: Uint8Array): SessionMigrationArchive {
	if (plaintext.byteLength > SESSION_MIGRATION_MAX_BYTES) throw new Error("Migration archive is too large");
	let value: unknown;
	try {
		if (plaintext.byteLength === 0) throw new Error("Migration backup is empty");
		value = JSON.parse(Buffer.from(plaintext).toString("utf8"));
	} catch (error) {
		throw new Error("Migration backup contents are invalid", { cause: error });
	}
	if (
		!isRecord(value) ||
		(value.schemaVersion !== undefined && value.schemaVersion !== 1) ||
		!Array.isArray(value.sessions) ||
		!Array.isArray(value.messages)
	) {
		throw new Error("Unsupported migration backup version");
	}
	if (value.sessions.length > 20_000 || value.messages.length > 20_000)
		throw new Error("Migration backup contains too many records");
	const sessions = value.sessions.map(parseSession);
	const sessionIds = new Set(sessions.map((session) => session.id));
	if (sessionIds.size !== sessions.length) throw new Error("Migration backup contains duplicate sessions");
	const groups = value.messages.map((group) => parseMessageGroup(group, sessionIds));
	if (new Set(groups.map((group) => group.sessionId)).size !== groups.length)
		throw new Error("Migration backup contains duplicate message groups");
	const totalMessages = groups.reduce((count, group) => count + group.items.length, 0);
	if (totalMessages > 200_000) throw new Error("Migration backup contains too many messages");
	return {
		schemaVersion: 1,
		exportedAtEpochMs: finiteNumber(value.exportedAtEpochMs, "exportedAtEpochMs"),
		sessions,
		messages: groups,
	};
}

function parseSession(value: unknown): SessionMigrationSession {
	if (!isRecord(value)) throw new Error("Migration backup contains an invalid session");
	return {
		id: requiredString(value.id, "session.id"),
		title: requiredString(value.title, "session.title"),
		modelId: optionalString(value.modelId),
		modelName: optionalString(value.modelName),
		createdAtEpochMs: finiteNumber(value.createdAtEpochMs, "session.createdAtEpochMs"),
		updatedAtEpochMs: finiteNumber(value.updatedAtEpochMs, "session.updatedAtEpochMs"),
		pinned: value.pinned === true,
		origin: optionalString(value.origin) ?? "Cloud",
		remoteDeviceId: optionalString(value.remoteDeviceId),
		remoteSessionId: optionalString(value.remoteSessionId),
		remoteSessionCreatedOnMobile: value.remoteSessionCreatedOnMobile === true,
		titleManuallyEdited: value.titleManuallyEdited === true,
	};
}

function parseMessageGroup(value: unknown, sessionIds: ReadonlySet<string>): SessionMigrationMessageGroup {
	if (!isRecord(value)) throw new Error("Migration backup contains an invalid message group");
	const sessionId = requiredString(value.sessionId, "message.sessionId");
	if (!sessionIds.has(sessionId) || !Array.isArray(value.items))
		throw new Error("Migration backup contains an unknown session reference");
	return { sessionId, items: value.items.map((item) => parseMessage(item, sessionId)) };
}

function parseMessage(value: unknown, sessionId: string): SessionMigrationMessage {
	if (!isRecord(value) || value.sessionId !== sessionId)
		throw new Error("Migration backup contains an invalid message");
	const role = value.role;
	if (role !== "system" && role !== "user" && role !== "assistant")
		throw new Error("Migration backup contains an unsupported message role");
	const status = value.status;
	if (
		status !== "Pending" &&
		status !== "Streaming" &&
		status !== "Complete" &&
		status !== "Error" &&
		status !== "Aborted"
	) {
		throw new Error("Migration backup contains an invalid message status");
	}
	if (typeof value.content !== "string") throw new Error("Migration backup contains invalid message text");
	const images = value.images === undefined ? [] : value.images;
	const toolEvents = value.toolEvents === undefined ? [] : value.toolEvents;
	if (!Array.isArray(images) || !Array.isArray(toolEvents))
		throw new Error("Migration backup contains invalid message attachments");
	return {
		id: requiredString(value.id, "message.id"),
		sessionId,
		role,
		content: value.content,
		status,
		createdAtEpochMs: finiteNumber(value.createdAtEpochMs, "message.createdAtEpochMs"),
		errorMessage: optionalString(value.errorMessage),
		images: images.map(parseImage),
		toolEvents: toolEvents.map(parseToolEvent),
		usage: isRecord(value.usage)
			? {
					promptTokens: optionalFiniteNumber(value.usage.promptTokens),
					completionTokens: optionalFiniteNumber(value.usage.completionTokens),
					totalTokens: optionalFiniteNumber(value.usage.totalTokens),
				}
			: undefined,
		contextPercent: optionalFiniteNumber(value.contextPercent),
		pendingQuestion: value.pendingQuestion,
	};
}

function parseImage(value: unknown): SessionMigrationImage {
	if (!isRecord(value)) throw new Error("Migration backup contains an invalid image");
	const mimeType = requiredString(value.mimeType, "image.mimeType");
	if (!mimeType.startsWith("image/")) throw new Error("Migration backup contains a non-image attachment");
	return {
		id: requiredString(value.id, "image.id"),
		mimeType,
		fileName: optionalString(value.fileName),
		base64Data: optionalString(value.base64Data),
		storageKey: optionalString(value.storageKey),
	};
}

function parseToolEvent(value: unknown): SessionMigrationToolEvent {
	if (!isRecord(value)) throw new Error("Migration backup contains an invalid tool record");
	return {
		phase: requiredString(value.phase, "tool.phase"),
		toolCallId: requiredString(value.toolCallId, "tool.toolCallId"),
		toolName: requiredString(value.toolName, "tool.toolName"),
		detail: optionalString(value.detail),
		durationMs: optionalFiniteNumber(value.durationMs),
		arguments: optionalString(value.arguments),
		result: optionalString(value.result),
		phaseLabel: optionalString(value.phaseLabel),
	};
}

function deriveKey(passphrase: string, salt: Uint8Array): Buffer {
	return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_BYTES, "sha256");
}

function assertPassphrase(value: string): void {
	if (value.length < 8 || value.length > 128) throw new Error("Migration password must be 8 to 128 characters");
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 2_000_000) throw new Error(`Invalid ${field}`);
	return value;
}

function optionalString(value: unknown): string | null | undefined {
	if (value === undefined || value === null) return value;
	if (typeof value !== "string" || value.length > 2_000_000) throw new Error("Invalid optional migration text");
	return value;
}

function finiteNumber(value: unknown, field: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${field}`);
	return value;
}

function optionalFiniteNumber(value: unknown): number | null | undefined {
	if (value === undefined || value === null) return value;
	if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid optional migration number");
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
