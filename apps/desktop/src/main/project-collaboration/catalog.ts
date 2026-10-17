import { stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type { Message } from "@567agent/ai";
import type { HistoryEntry, RuntimeHost } from "@567agent/runtime-core";
import type { ProjectCollaborationCandidate } from "../../shared/project-collaboration.js";
import type { DesktopSessionHistoryInfo } from "../../shared/session-access.js";
import { getDesktopConversationService } from "../conversations/desktop-conversation-service.js";

const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const MAX_PAGE_TEXT = 32_000;
const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

export interface ProjectCollaborationHistoryEntry {
	readonly id: string;
	readonly role: "user" | "assistant";
	readonly text: string;
	readonly timestamp: number;
	readonly attachments?: readonly { readonly name: string; readonly path?: string }[];
}

function normalizedPath(path: string): string {
	const absolute = resolve(path).normalize("NFC");
	return process.platform === "win32" ? absolute.toLowerCase() : absolute;
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

type CollaborationMessage = Extract<Message, { role: "user" | "assistant" }>;

function isHistoryMessage(
	entry: HistoryEntry,
): entry is Extract<HistoryEntry, { type: "message" }> & { message: CollaborationMessage } {
	return entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant");
}

function displayTitle(session: DesktopSessionHistoryInfo): string {
	return session.name?.trim() || session.firstMessage.trim().slice(0, 120) || basename(session.path);
}

function modelName(model: unknown): string | null {
	if (typeof model !== "object" || model === null) return null;
	const candidate = model as { name?: unknown; id?: unknown };
	if (typeof candidate.name === "string" && candidate.name.trim()) return candidate.name.trim();
	return typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : null;
}

function historyEntries(history: readonly HistoryEntry[]): ProjectCollaborationHistoryEntry[] {
	const result: ProjectCollaborationHistoryEntry[] = [];
	let pendingAttachments: { name: string; path?: string }[] = [];
	for (const entry of history) {
		if (entry.type === "prompt_attachments_marker") {
			pendingAttachments = entry.attachments.map((attachment) => ({
				name: basename(attachment.path) || attachment.path,
				path: attachment.path,
			}));
			continue;
		}
		if (!isHistoryMessage(entry)) continue;
		const message = entry.message;
		if (message.role === "assistant" && message.stopReason === "toolUse") continue;
		const id = entry.entryId || `${message.role}:${message.timestamp}:${result.length}`;
		const attachments = message.role === "user" ? pendingAttachments : [];
		if (message.role === "user") pendingAttachments = [];
		result.push({
			id,
			role: message.role,
			text: messageText(message),
			timestamp: message.timestamp,
			...(attachments.length ? { attachments } : {}),
		});
	}
	return result;
}

function splitLongMessages(entries: readonly ProjectCollaborationHistoryEntry[]): ProjectCollaborationHistoryEntry[] {
	const result: ProjectCollaborationHistoryEntry[] = [];
	for (const entry of entries) {
		if (entry.text.length <= MAX_PAGE_TEXT) {
			result.push(entry);
			continue;
		}
		for (let offset = 0, part = 0; offset < entry.text.length; offset += MAX_PAGE_TEXT, part++) {
			result.push({
				id: `${entry.id}#${part + 1}`,
				role: entry.role,
				timestamp: entry.timestamp,
				text: entry.text.slice(offset, offset + MAX_PAGE_TEXT),
				...(part === 0 && entry.attachments ? { attachments: entry.attachments } : {}),
			});
		}
	}
	return result;
}

export class ProjectCollaborationCatalog {
	constructor(private readonly runtime: RuntimeHost) {}

	async list(cwd: string): Promise<ProjectCollaborationCandidate[]> {
		if (!isAbsolute(cwd)) throw new Error("Project collaboration requires an absolute project path");
		const projectCwd = normalizedPath(cwd);
		const sessions = await getDesktopConversationService().listSessions(projectCwd);
		return sessions
			.filter((session) => normalizedPath(session.cwd) === projectCwd && isAbsolute(session.path))
			.map((session) => {
				const openPath = this.runtime.getSessionPath(session.id);
				const isOpen = openPath !== undefined && normalizedPath(openPath) === normalizedPath(session.path);
				let model: string | null = null;
				let running = false;
				if (isOpen) {
					try {
						const state = this.runtime.getState(session.id);
						model = modelName(state.model);
						running = Boolean(state.isStreaming);
					} catch {
						// A path can outlive its in-memory session during disposal; keep it catalogued.
					}
				}
				return {
					sessionId: session.id,
					path: session.path,
					title: displayTitle(session),
					preview: session.lastMessagePreview || session.firstMessage || "",
					modifiedAt: session.modifiedAt,
					model,
					state: session.access.resume ? (running ? "running" : "idle") : "unavailable",
				};
			});
	}

	async resolve(cwd: string, sessionId: string): Promise<ProjectCollaborationCandidate> {
		if (!isAbsolute(cwd)) throw new Error("Project collaboration requires an absolute project path");
		if (typeof sessionId !== "string" || !sessionId.trim()) throw new Error("Invalid conversation id");
		const projectCwd = normalizedPath(cwd);
		const candidate = (await this.list(projectCwd)).find((entry) => entry.sessionId === sessionId);
		if (!candidate) throw new Error("Conversation is not in this project catalog");
		const access = await this.runtime.resolveSessionAccess(candidate.path);
		if (!access) throw new Error(`Conversation ${sessionId} is no longer available to the runtime`);
		if (!access.readHistory) throw new Error(`Conversation ${sessionId} history is not readable`);
		if (!access.resume) throw new Error(`Conversation ${sessionId} cannot be restored for collaboration`);
		return candidate;
	}

	async readHistory(
		cwd: string,
		sessionId: string,
		cursor = 0,
		limit = DEFAULT_PAGE_LIMIT,
	): Promise<{ entries: readonly ProjectCollaborationHistoryEntry[]; nextCursor: number | null }> {
		const candidate = await this.resolve(cwd, sessionId);
		if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error("Invalid conversation history cursor");
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
			throw new Error(`Conversation history page limit must be between 1 and ${MAX_PAGE_LIMIT}`);
		}
		const file = await stat(candidate.path);
		if (!file.isFile()) throw new Error(`Conversation history is not a regular file: ${candidate.path}`);
		if (file.size > MAX_SESSION_BYTES)
			throw new Error(`Conversation history exceeds the ${MAX_SESSION_BYTES}-byte limit`);

		const openPath = this.runtime.getSessionPath(sessionId);
		const history =
			openPath !== undefined && normalizedPath(openPath) === normalizedPath(candidate.path)
				? this.runtime.getFullHistory(sessionId)
				: this.runtime.readSessionHistoryFromFile(candidate.path).history;
		const fragments = splitLongMessages(historyEntries(history));
		if (cursor > fragments.length) throw new Error("Conversation history cursor is out of range");
		const page: ProjectCollaborationHistoryEntry[] = [];
		let textLength = 0;
		for (let index = cursor; index < fragments.length && page.length < limit; index++) {
			const entry = fragments[index];
			if (page.length > 0 && textLength + entry.text.length > MAX_PAGE_TEXT) break;
			page.push(entry);
			textLength += entry.text.length;
		}
		const next = cursor + page.length;
		return { entries: page, nextCursor: next < fragments.length ? next : null };
	}
}
