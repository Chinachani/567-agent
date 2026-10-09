import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import type { ImageContent, Message } from "@567agent/ai";
import type { HistoryEntry } from "@567agent/runtime-core";
import type { DesktopSessionHistoryInfo } from "../../shared/session-access.js";
import type {
	SessionMigrationArchive,
	SessionMigrationImage,
	SessionMigrationMessage,
} from "./session-migration-backup.js";

export async function buildDesktopSessionMigrationArchive(
	sessions: readonly DesktopSessionHistoryInfo[],
	historyByPath: ReadonlyMap<string, readonly HistoryEntry[]>,
	nowEpochMs = Date.now(),
): Promise<SessionMigrationArchive> {
	const archiveSessions: SessionMigrationArchive["sessions"][number][] = [];
	const messageGroups: SessionMigrationArchive["messages"][number][] = [];
	for (const session of sessions) {
		const history = historyByPath.get(session.path) ?? [];
		const converted = convertHistoryToMobileMessages(history);
		const messages = await includeImportedAssistantMedia(converted.messages, session.cwd);
		archiveSessions.push({
			id: session.id,
			title: session.name?.trim() || session.firstMessage.trim() || "未命名对话",
			createdAtEpochMs: converted.messages[0]?.createdAtEpochMs ?? session.modifiedAt,
			updatedAtEpochMs: session.modifiedAt,
			pinned: false,
			origin: "Cloud",
		});
		messageGroups.push({
			sessionId: session.id,
			items: messages.map((message) => ({ ...message, sessionId: session.id })),
		});
	}
	return {
		schemaVersion: 1,
		exportedAtEpochMs: nowEpochMs,
		sessions: archiveSessions,
		messages: messageGroups,
	};
}

async function includeImportedAssistantMedia(
	messages: readonly SessionMigrationMessage[],
	cwd: string,
): Promise<readonly SessionMigrationMessage[]> {
	const mediaRoot = await realpath(resolve(cwd, ".567agent", "imported-media")).catch(() =>
		resolve(cwd, ".567agent", "imported-media"),
	);
	return Promise.all(
		messages.map(async (message) => {
			if (message.role !== "assistant" || !message.content) return message;
			const refs = [
				...message.content.matchAll(/!\[导入的图片\]\((\.567agent\/imported-media\/[A-Za-z0-9._-]+)\)/g),
			];
			if (refs.length === 0) return message;
			const images: SessionMigrationImage[] = [...(message.images ?? [])];
			for (const [index, match] of refs.entries()) {
				const relativePath = match[1];
				if (!relativePath) continue;
				const path = await realpath(resolve(cwd, relativePath));
				const mediaRelativePath = relative(mediaRoot, path);
				if (
					mediaRelativePath === ".." ||
					mediaRelativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
					isAbsolute(mediaRelativePath)
				) {
					throw new Error("Imported assistant image reference escaped its media directory");
				}
				const bytes = await readFile(path);
				const mimeType = mimeTypeForImageExtension(extname(path));
				if (!mimeType) throw new Error(`Unsupported imported assistant image type: ${extname(path)}`);
				images.push({
					id: `imported-${message.id}-${index}`,
					mimeType,
					base64Data: bytes.toString("base64"),
				});
			}
			return { ...message, images };
		}),
	);
}

function mimeTypeForImageExtension(extension: string): string | undefined {
	return {
		".png": "image/png",
		".jpg": "image/jpeg",
		".jpeg": "image/jpeg",
		".gif": "image/gif",
		".webp": "image/webp",
		".svg": "image/svg+xml",
	}[extension.toLowerCase()];
}

export function convertHistoryToMobileMessages(history: readonly HistoryEntry[]): {
	readonly messages: readonly SessionMigrationMessage[];
} {
	const messages: SessionMigrationMessage[] = [];
	const lastAssistantIndex = (): number => {
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			if (messages[index]?.role === "assistant") return index;
		}
		return -1;
	};
	for (const entry of history) {
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user") {
			const content = messageContent(message);
			messages.push({
				id: entry.entryId || randomUUID(),
				sessionId: "",
				role: "user",
				content: content.text,
				status: "Complete",
				createdAtEpochMs: message.timestamp,
				images: content.images,
			});
			continue;
		}
		if (message.role === "assistant") {
			const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
			const toolEvents = message.content
				.filter((part) => part.type === "toolCall")
				.map((part) => ({
					phase: part.isError ? "error" : part.result !== undefined ? "completed" : "started",
					toolCallId: part.id,
					toolName: part.name,
					arguments: JSON.stringify(part.arguments),
					result: part.result,
					durationMs: part.durationMs,
				}));
			messages.push({
				id: entry.entryId || randomUUID(),
				sessionId: "",
				role: "assistant",
				content: text,
				status: message.stopReason === "error" ? "Error" : "Complete",
				createdAtEpochMs: message.timestamp,
				errorMessage: message.errorMessage,
				toolEvents,
				usage: {
					promptTokens: message.usage.input,
					completionTokens: message.usage.output,
					totalTokens: message.usage.totalTokens,
				},
			});
			continue;
		}
		if (message.role === "toolResult") {
			const index = lastAssistantIndex();
			if (index < 0) continue;
			const current = messages[index];
			if (!current) continue;
			const result = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
			const trace = {
				phase: message.isError ? "error" : "completed",
				toolCallId: message.toolCallId,
				toolName: message.toolName,
				result,
			};
			const images = message.content
				.filter((part): part is ImageContent => part.type === "image")
				.map((part, imageIndex) => imageToMobileImage(part, `${message.toolCallId}-${imageIndex}`));
			messages[index] = {
				...current,
				toolEvents: [...(current.toolEvents ?? []), trace],
				images: [...(current.images ?? []), ...images],
			};
		}
	}
	return { messages };
}

function messageContent(message: Message): { text: string; images: SessionMigrationImage[] } {
	if (message.role !== "user") return { text: "", images: [] };
	if (typeof message.content === "string") return { text: message.content, images: [] };
	const text = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");
	const images = message.content
		.filter((part): part is ImageContent => part.type === "image")
		.map((part, index) => imageToMobileImage(part, `${message.timestamp}-${index}`));
	return { text, images };
}

function imageToMobileImage(image: ImageContent, id: string): SessionMigrationImage {
	return {
		id,
		mimeType: image.mimeType,
		base64Data: image.data.includes(",") ? image.data.slice(image.data.indexOf(",") + 1) : image.data,
	};
}
