import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { Message } from "@567agent/ai";
import type {
	SessionAttachmentAsset,
	SessionChangeAsset,
	SessionTaskAsset,
	SessionWorkbenchDetail,
	SessionWorkbenchSnapshot,
} from "@567agent/remote-control";
import type { HistoryEntry } from "@567agent/runtime-core";
import { atomicWriteJSONAsync } from "@567agent/toolkit/atomic-write";
import { readEditableTextFile, saveEditableTextFile } from "../filesystem/filesystem-service.js";

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hash(value: string) {
	return createHash("sha256").update(value).digest("hex");
}
function messageText(message: Message): string {
	return typeof message.content === "string"
		? message.content
		: message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}
function attachmentsFrom(history: readonly HistoryEntry[]): SessionAttachmentAsset[] {
	const attachments = new Map<string, SessionAttachmentAsset>();
	for (let index = history.length - 1; index >= 0 && attachments.size < 200; index--) {
		const entry = history[index];
		if (entry.type !== "prompt_attachments_marker") continue;
		for (const file of [...entry.attachments].reverse()) {
			const id = hash(`${file.kind}:${file.path}`);
			if (!attachments.has(id))
				attachments.set(id, { id, name: basename(file.path), path: file.path, kind: file.kind });
			if (attachments.size === 200) break;
		}
	}
	return [...attachments.values()].reverse();
}
interface Receipt {
	path: string;
	beforeText: string;
	afterText: string;
	beforeRevision: string;
	afterRevision: string;
}
function receipt(value: unknown): Receipt | undefined {
	if (
		!object(value) ||
		value.version !== 1 ||
		typeof value.path !== "string" ||
		!isAbsolute(value.path) ||
		typeof value.beforeText !== "string" ||
		typeof value.afterText !== "string" ||
		Buffer.byteLength(value.beforeText) > 65536 ||
		Buffer.byteLength(value.afterText) > 65536 ||
		value.beforeRevision !== hash(value.beforeText) ||
		value.afterRevision !== hash(value.afterText)
	)
		return undefined;
	return {
		path: value.path,
		beforeText: value.beforeText,
		afterText: value.afterText,
		beforeRevision: value.beforeRevision as string,
		afterRevision: value.afterRevision as string,
	};
}
function collect(history: readonly HistoryEntry[], running: boolean) {
	const changes: { id: string; path: string; receipt?: Receipt; diff: string }[] = [];
	const tasks: { summary: SessionTaskAsset; text: string }[] = [];
	let task: { summary: SessionTaskAsset; text: string } | undefined;
	for (const entry of history) {
		if (entry.type === "assistant_turn_timing" && task)
			task.summary = { ...task.summary, durationMs: entry.timing.durationMs };
		if (entry.type === "error" && task) {
			task.summary = { ...task.summary, status: "failed" };
			task.text += `\n${entry.message}`;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user") {
			if (task && task.summary.status === "running") task.summary = { ...task.summary, status: "interrupted" };
			task = {
				summary: {
					id: entry.entryId ?? `user:${message.timestamp}`,
					title: messageText(message).slice(0, 100),
					timestamp: message.timestamp,
					status: "running",
					durationMs: null,
					toolCount: 0,
				},
				text: "",
			};
			tasks.push(task);
			if (tasks.length > 200) tasks.shift();
		} else if (message.role === "assistant" && task) {
			task.text = `${task.text}\n${messageText(message)}`.slice(-32768);
			task.summary = {
				...task.summary,
				status:
					message.stopReason === "error"
						? "failed"
						: message.stopReason === "aborted"
							? "interrupted"
							: message.stopReason === "toolUse"
								? "running"
								: "completed",
				toolCount: task.summary.toolCount + message.content.filter((part) => part.type === "toolCall").length,
			};
		} else if (message.role === "toolResult") {
			if (task)
				task.text = (
					task.text +
					`\n\n[${message.toolName}: ${message.isError ? "failed" : "completed"}]\n` +
					messageText(message).slice(0, 8000)
				).slice(-32768);
			if (!message.isError && (message.toolName === "edit" || message.toolName === "write")) {
				const details = object(message.details) ? message.details : {};
				const captured = receipt(details.fileChange);
				if (captured || typeof details.diff === "string")
					changes.push({
						id: message.toolCallId,
						path: captured?.path ?? "",
						...(captured ? { receipt: captured } : {}),
						diff: typeof details.diff === "string" ? details.diff.slice(0, 32768) : "",
					});
				if (changes.length > 200) changes.shift();
			}
		}
	}
	if (task?.summary.status === "running" && !running) task.summary = { ...task.summary, status: "interrupted" };
	return {
		attachments: attachmentsFrom(history),
		tasks,
		changes,
	};
}
async function within(cwd: string, path: string): Promise<string> {
	const root = await realpath(cwd);
	const target = await realpath(isAbsolute(path) ? path : resolve(cwd, path));
	const part = relative(root, target);
	if (part === ".." || part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) || isAbsolute(part))
		throw new Error("This file is outside the session workspace");
	return target;
}

async function attachedPath(cwd: string, path: string): Promise<string> {
	try {
		return await within(cwd, path);
	} catch {
		// Outside the workspace only a literal, explicitly attached path is
		// readable; do not follow a later-retargeted symlink or parent alias.
		const target = await realpath(path);
		const normalized = resolve(path);
		if (process.platform === "win32" ? target.toLowerCase() !== normalized.toLowerCase() : target !== normalized)
			throw new Error("External attachment aliases require reattachment");
		return target;
	}
}

export class SessionWorkbench {
	private writing = false;
	constructor(
		private readonly sessionPath: string,
		private readonly cwd: string,
		private readonly history: () => readonly HistoryEntry[],
		private readonly busy: () => boolean,
	) {}
	private async reviewStates(): Promise<Record<string, "kept" | "reverted">> {
		try {
			const value: unknown = JSON.parse(await readFile(`${this.sessionPath}.review.json`, "utf8"));
			if (!object(value) || value.schemaVersion !== 1 || !object(value.states))
				throw new Error("Invalid review state");
			return Object.fromEntries(
				Object.entries(value.states).filter(
					(entry): entry is [string, "kept" | "reverted"] => entry[1] === "kept" || entry[1] === "reverted",
				),
			);
		} catch (error) {
			if (object(error) && error.code === "ENOENT") return {};
			throw error;
		}
	}
	async read(): Promise<SessionWorkbenchSnapshot> {
		const data = collect(this.history(), this.busy());
		const states = await this.reviewStates();
		return {
			attachments: data.attachments,
			tasks: data.tasks.map((task) => task.summary).reverse(),
			changes: data.changes
				.map(
					(change): SessionChangeAsset => ({
						id: change.id,
						path: change.path,
						status: states[change.id] ?? "pending",
						reversible: Boolean(change.receipt),
					}),
				)
				.reverse(),
		};
	}
	async detail(kind: string, id: string): Promise<SessionWorkbenchDetail> {
		if (kind === "task") {
			const data = collect(this.history(), this.busy());
			const task = data.tasks.find((item) => item.summary.id === id);
			if (!task) throw new Error("Task no longer exists");
			return { kind, id, title: task.summary.title, text: task.text };
		}
		if (kind === "change") {
			const data = collect(this.history(), this.busy());
			const change = data.changes.find((item) => item.id === id);
			if (!change) throw new Error("Change no longer exists");
			let reversible = false;
			if (change.receipt && !this.busy() && (await this.reviewStates())[id] !== "reverted") {
				try {
					const path = await within(this.cwd, change.path);
					reversible = (await readEditableTextFile(path)).revision === change.receipt.afterRevision;
				} catch {}
			}
			return {
				kind,
				id,
				title: basename(change.path) || id,
				text: change.diff,
				path: change.path,
				beforeText: change.receipt?.beforeText,
				afterText: change.receipt?.afterText,
				afterRevision: change.receipt?.afterRevision,
				reversible,
			};
		}
		const file = attachmentsFrom(this.history()).find((item) => item.id === id);
		if (kind !== "attachment" || !file) throw new Error("Attachment no longer exists");
		try {
			const path = await attachedPath(this.cwd, file.path);
			const info = await stat(path);
			if (!info.isFile())
				return { kind, id, title: file.name, path: file.path, text: "", previewStatus: "unavailable" };
			const handle = await open(path, "r");
			const buffer = Buffer.alloc(Math.min(32768, info.size));
			let count: number;
			try {
				count = (await handle.read(buffer, 0, buffer.length, 0)).bytesRead;
			} finally {
				await handle.close();
			}
			const bytes = buffer.subarray(0, count);
			let preview: string | undefined;
			try {
				preview = new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: info.size > count });
				if (preview.includes("\0")) preview = undefined;
			} catch {}
			return {
				kind,
				id,
				title: file.name,
				path: file.path,
				sizeBytes: info.size,
				text: preview ?? "",
				previewStatus: preview === undefined ? "binary" : "text",
			};
		} catch {
			return { kind, id, title: file.name, path: file.path, text: "", previewStatus: "unavailable" };
		}
	}
	async chunk(id: string, offset: number, length: number) {
		if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 65536)
			throw new Error("Invalid attachment chunk range");
		const file = attachmentsFrom(this.history()).find((item) => item.id === id);
		if (!file) throw new Error("Attachment no longer exists");
		const path = await attachedPath(this.cwd, file.path);
		const info = await stat(path);
		if (!info.isFile() || info.size > 12 * 1024 * 1024 || offset > info.size)
			throw new Error("File is unavailable or exceeds the 12 MB transfer limit");
		const handle = await open(path, "r");
		const buffer = Buffer.alloc(Math.min(length, info.size - offset));
		try {
			const read = await handle.read(buffer, 0, buffer.length, offset);
			return {
				sizeBytes: info.size,
				revision: `${info.mtimeMs}:${info.size}`,
				dataBase64: buffer.subarray(0, read.bytesRead).toString("base64"),
			};
		} finally {
			await handle.close();
		}
	}
	async review(id: string, action: string, revision: string): Promise<SessionWorkbenchSnapshot> {
		if (this.writing || this.busy()) throw new Error("Wait for the current task before reviewing changes");
		this.writing = true;
		try {
			const change = collect(this.history(), false).changes.find((item) => item.id === id);
			if (!change || (action !== "keep" && action !== "revert")) throw new Error("Invalid review action");
			const states = await this.reviewStates();
			if (action === "revert") {
				const saved = change.receipt;
				if (!saved || states[id] === "reverted" || saved.afterRevision !== revision)
					throw new Error("No eligible original snapshot is available");
				const path = await within(this.cwd, saved.path);
				const current = await readEditableTextFile(path);
				if (current.revision !== saved.afterRevision)
					throw new Error("The file has changed since this task; automatic revert was refused");
				const backups = `${this.sessionPath}.review-backups`;
				await mkdir(backups, { recursive: true, mode: 0o700 });
				const files = await readdir(backups);
				let bytes = 0;
				for (const file of files) bytes += (await stat(join(backups, file))).size;
				if (bytes > 20 * 1024 * 1024)
					throw new Error("Review backups exceed 20 MB; preserve or move backups before reverting more files");
				await writeFile(
					join(backups, `${randomUUID()}.json`),
					JSON.stringify({ path, content: current.content, hasBom: current.hasBom, revision: current.revision }),
					{ flag: "wx", mode: 0o600 },
				);
				const result = await saveEditableTextFile(path, saved.beforeText, { expectedRevision: revision });
				if (result.status !== "saved") throw new Error("The file changed while reverting; it was preserved");
			}
			states[id] = action === "keep" ? "kept" : "reverted";
			await atomicWriteJSONAsync(`${this.sessionPath}.review.json`, { schemaVersion: 1, states });
			return await this.read();
		} finally {
			this.writing = false;
		}
	}
}
