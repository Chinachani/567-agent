import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AssistantMessage, ImageContent, TextContent, ToolCall, UserMessage } from "@567agent/ai";
import type { ConversationMessageRecord, RuntimeHost } from "@567agent/runtime-core";
import type { DesktopConversationService, DesktopConversationSession } from "./desktop-conversation-service.js";
import type { SessionMigrationArchive, SessionMigrationMessage } from "./session-migration-backup.js";

export interface MobileArchiveImportResult {
	readonly importedSessions: number;
	readonly importedMessages: number;
	readonly sessionPaths: readonly string[];
}

export async function importMobileSessionArchive(
	archive: SessionMigrationArchive,
	dependencies: {
		readonly runtime: RuntimeHost;
		readonly conversationService: DesktopConversationService;
		readonly cwd: string;
	},
): Promise<MobileArchiveImportResult> {
	const createdMediaPaths: string[] = [];
	let groups = new Map<string, readonly SessionMigrationMessage[]>();
	const created: DesktopConversationSession[] = [];
	let importedMessages = 0;
	try {
		groups = await prepareMessagesWithAssistantMedia(archive, dependencies.cwd, createdMediaPaths);
		for (const [sessionIndex, source] of archive.sessions.entries()) {
			// Older mobile backups may contain cached Desktop mirrors. The paired
			// computer already owns those conversations, so importing them would
			// create duplicate local sessions. Keep accepting legacy archives while
			// skipping only sessions explicitly marked as Desktop-owned.
			if (source.origin === "Desktop") continue;
			let session: DesktopConversationSession | undefined;
			try {
				session = await dependencies.conversationService.createSession(
					{ cwd: dependencies.cwd, scenario: "conversation" },
					"conversation",
					"interactive",
				);
				created.push(session);
				await dependencies.runtime.renameSessionById(session.sessionId, source.title.trim() || "导入的对话");
				let turnId = randomUUID();
				for (const [messageIndex, sourceMessage] of (groups.get(source.id) ?? []).entries()) {
					try {
						if (sourceMessage.role === "user") turnId = randomUUID();
						const record = mobileMessageToConversationRecord(sourceMessage, turnId);
						if (!record) continue;
						await dependencies.runtime.appendConversationMessage(session.sessionId, record);
						importedMessages += 1;
					} catch (error) {
						throw contextualImportError(error, `message ${messageIndex + 1} (${sourceMessage.role})`);
					}
				}
			} catch (error) {
				const sessionLabel = source.title.trim() || source.id;
				throw contextualImportError(
					error,
					`session ${sessionIndex + 1} (${sessionLabel})${session ? `, desktop id ${session.sessionId}` : " while creating the desktop session"}`,
				);
			}
		}
		return {
			importedSessions: created.length,
			importedMessages,
			sessionPaths: created.map((session) => session.sessionPath),
		};
	} catch (error) {
		await Promise.allSettled(created.map((session) => dependencies.runtime.deleteSession(session.sessionPath)));
		await Promise.allSettled(createdMediaPaths.map((path) => rm(path, { force: true })));
		throw error;
	}
}

async function prepareMessagesWithAssistantMedia(
	archive: SessionMigrationArchive,
	cwd: string,
	createdPaths: string[],
): Promise<Map<string, readonly SessionMigrationMessage[]>> {
	const importableSessionIds = new Set(
		archive.sessions.filter((session) => session.origin !== "Desktop").map((s) => s.id),
	);
	const groups = new Map<string, readonly SessionMigrationMessage[]>();
	for (const group of archive.messages) {
		if (!importableSessionIds.has(group.sessionId)) continue;
		const items: SessionMigrationMessage[] = [];
		for (const message of group.items) {
			if (message.role !== "assistant" || !message.images?.length) {
				items.push(message);
				continue;
			}
			const links: string[] = [];
			for (const image of message.images) {
				const data = decodeImage(image.base64Data);
				if (!data) throw new Error(`Imported assistant image ${image.id} has invalid or empty data`);
				const extension = IMAGE_EXTENSIONS[image.mimeType.toLowerCase()];
				if (!extension) throw new Error(`Unsupported imported assistant image type: ${image.mimeType}`);
				const relativePath = `.567agent/imported-media/${randomUUID()}.${extension}`;
				const absolutePath = join(cwd, ...relativePath.split("/"));
				await mkdir(join(cwd, ".567agent", "imported-media"), { recursive: true, mode: 0o700 });
				await writeFile(absolutePath, data, { mode: 0o600, flag: "wx" });
				createdPaths.push(absolutePath);
				links.push(`![导入的图片](${relativePath})`);
			}
			items.push({ ...message, content: [message.content, ...links].filter(Boolean).join("\n\n"), images: [] });
		}
		groups.set(group.sessionId, items);
	}
	return groups;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/jpg": "jpg",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
};

function contextualImportError(error: unknown, context: string): Error {
	const detail = error instanceof Error ? error.message : String(error);
	return new Error(`Mobile conversation import failed at ${context}: ${detail}`, { cause: error });
}

export function mobileMessageToConversationRecord(
	message: SessionMigrationMessage,
	turnId: string,
): ConversationMessageRecord | undefined {
	const id = randomUUID();
	const timestamp = message.createdAtEpochMs;
	if (message.role === "system") {
		const text = message.content.trim();
		if (!text) return undefined;
		return {
			kind: "agent",
			id,
			turnId,
			timestamp,
			author: { kind: "agent", id: "imported-mobile" },
			message: createAssistantMessage(`[系统消息] ${text}`, message, timestamp),
		};
	}
	if (message.role === "user") {
		return {
			kind: "user",
			id,
			turnId,
			timestamp,
			author: { kind: "user", id: "imported-mobile-user" },
			message: createUserMessage(message, timestamp),
		};
	}
	return {
		kind: "agent",
		id,
		turnId,
		timestamp,
		author: { kind: "agent", id: "imported-mobile" },
		message: createAssistantMessage(message.content, message, timestamp),
	};
}

function createUserMessage(message: SessionMigrationMessage, timestamp: number): UserMessage {
	const content: (TextContent | ImageContent)[] = [];
	if (message.content) content.push({ type: "text", text: message.content });
	for (const image of message.images ?? []) {
		const data = decodeImage(image.base64Data);
		if (data) content.push({ type: "image", mimeType: image.mimeType, data: data.toString("base64") });
	}
	return { role: "user", content: content.length ? content : "", timestamp };
}

function createAssistantMessage(text: string, source: SessionMigrationMessage, timestamp: number): AssistantMessage {
	const content: AssistantMessage["content"] = [];
	if (text) content.push({ type: "text", text });
	for (const trace of source.toolEvents ?? []) {
		let argumentsValue: Record<string, unknown> = {};
		if (trace.arguments) {
			try {
				const parsed: unknown = JSON.parse(trace.arguments);
				if (isRecord(parsed)) argumentsValue = parsed;
			} catch {
				argumentsValue = { importedArguments: trace.arguments.slice(0, 8_192) };
			}
		}
		const result = [trace.phaseLabel, trace.detail, trace.result]
			.filter((part): part is string => typeof part === "string" && part.length > 0)
			.join("\n")
			.slice(0, 16_384);
		const normalizedPhase = trace.phase.trim().toLowerCase();
		const toolCall: ToolCall = {
			type: "toolCall",
			id: trace.toolCallId || randomUUID(),
			name: trace.toolName || "tool",
			arguments: argumentsValue,
		};
		if (result) toolCall.result = result;
		if (normalizedPhase.includes("error") || normalizedPhase.includes("failed")) toolCall.isError = true;
		if (typeof trace.durationMs === "number" && Number.isFinite(trace.durationMs)) {
			toolCall.durationMs = Math.max(0, trace.durationMs);
		}
		content.push(toolCall);
	}
	if (source.status === "Error" && source.errorMessage) {
		content.push({ type: "text", text: `\n\n[原回复失败：${source.errorMessage.slice(0, 2_000)}]` });
	}
	const usage = source.usage;
	const input = usage?.promptTokens ?? 0;
	const output = usage?.completionTokens ?? 0;
	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "imported-mobile",
		model: "imported-history",
		usage: {
			input,
			output,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: usage?.totalTokens ?? input + output,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp,
	};
}

function decodeImage(value: string | null | undefined): Buffer | undefined {
	if (!value) return undefined;
	const payload = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
	if (!/^[A-Za-z0-9+/=_-]+$/.test(payload)) return undefined;
	const decoded = Buffer.from(payload.replaceAll("-", "+").replaceAll("_", "/"), "base64");
	return decoded.byteLength > 0 ? decoded : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
