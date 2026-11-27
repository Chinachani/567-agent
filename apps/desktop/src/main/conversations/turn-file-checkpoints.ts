import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, realpath, rename, rm, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { getAgentDir } from "@567agent/coding-agent/config";
import type { StoredSessionEvent, TurnObserver } from "@567agent/runtime-core/kernel";
import { z } from "zod";
import type {
	TurnFileRestoreEntry,
	TurnFileRestorePreview,
	TurnFilesSummary,
} from "../../shared/session-workbench-ipc.js";
import {
	captureWorkspace,
	checkedParent,
	containsPath,
	type FileState,
	fileSnapshotSchema,
	readFileState,
	restoreFileState,
	sameFileState,
	snapshotPath,
	type WorkspaceSnapshot,
	workspaceIdentity,
} from "./turn-file-snapshot.js";

const MAX_CHECKPOINTS = 20;
const MAX_STORE_BYTES = 8 * 1024 * 1024;
const MAX_CHANGES = 200;
const stateSchema = z.union([fileSnapshotSchema, z.null(), z.literal("unsupported")]);
const changeSchema = z.object({
	path: z.string().min(1),
	before: stateSchema,
	after: stateSchema,
	missingParent: z.literal(true).optional(),
});
const checkpointSchema = z.object({
	turnId: z.string().min(1),
	timestamp: z.number(),
	title: z.string().max(100),
	root: z.string(),
	identity: z.string(),
	files: z.array(changeSchema).max(MAX_CHANGES),
});
const storeSchema = z.object({ version: z.literal(1), checkpoints: z.array(checkpointSchema).max(MAX_CHECKPOINTS) });
type FileChange = z.infer<typeof changeSchema>;
type Checkpoint = z.infer<typeof checkpointSchema>;

interface ActiveCapture {
	readonly root: string;
	readonly timestamp: number;
	before?: WorkspaceSnapshot;
	title: string;
	overlapped: boolean;
}

const activeCaptures = new Set<ActiveCapture>();
const activeRestores = new Map<string, Promise<void>>();
const checkpointsBySession = new Map<string, TurnFileCheckpoints>();
const overlaps = (left: string, right: string) => containsPath(left, right) || containsPath(right, left);

export const desktopTurnFileObserver: TurnObserver = {
	id: "desktop.turn-file-checkpoints",
	async observe(event, signal) {
		await checkpointsBySession.get(event.sessionId)?.observe(event, signal);
	},
};

export function bindTurnFileCheckpoints(sessionId: string, checkpoints: TurnFileCheckpoints): void {
	checkpointsBySession.set(sessionId, checkpoints);
}

export function unbindTurnFileCheckpoints(sessionId: string): void {
	checkpointsBySession.get(sessionId)?.dispose();
	checkpointsBySession.delete(sessionId);
}

export function turnFileCheckpointPath(sessionId: string): string {
	const key = createHash("sha256").update(sessionId).digest("hex");
	return join(getAgentDir(), "turn-file-checkpoints", `${key}.json`);
}

export async function deleteTurnFileCheckpoints(sessionId: string): Promise<void> {
	await rm(turnFileCheckpointPath(sessionId), { force: true });
	unbindTurnFileCheckpoints(sessionId);
}

export function isTurnFileRestoreActive(cwd: string): boolean {
	return [...activeRestores.keys()].some((root) => overlaps(root, cwd));
}

function hiddenBefore(snapshot: WorkspaceSnapshot, path: string): boolean {
	if (snapshot.ignored.has(path)) return true;
	for (let split = path.indexOf("/"); split >= 0; split = path.indexOf("/", split + 1)) {
		const parent = path.slice(0, split);
		if (
			snapshot.ignored.has(parent) ||
			snapshot.ignored.has(`${parent}/`) ||
			snapshot.files.has(`${parent}/`) ||
			snapshot.files.get(parent) === "unsupported"
		)
			return true;
	}
	return false;
}

function changedFiles(before: WorkspaceSnapshot, after: WorkspaceSnapshot): FileChange[] {
	return [...after.files].flatMap(([path, next]) => {
		const previous = before.files.has(path)
			? (before.files.get(path) ?? null)
			: hiddenBefore(before, path)
				? "unsupported"
				: null;
		return sameFileState(previous, next)
			? []
			: [
					{
						path,
						before: previous,
						after: next,
						...(after.missingParents.has(path) ? { missingParent: true as const } : {}),
					},
				];
	});
}

function summarizeChange(before: FileState, after: FileState): TurnFileRestoreEntry["change"] {
	if (before === "unsupported" || after === "unsupported") return "unsupported";
	return before === null ? "added" : after === null ? "deleted" : "modified";
}

function formatStore(checkpoints: Checkpoint[]): string {
	return JSON.stringify({ version: 1, checkpoints });
}

async function writeStore(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temp = `${path}.${randomUUID()}.tmp`;
	const file = await open(temp, "wx", 0o600);
	try {
		try {
			await file.writeFile(content, "utf8");
			await file.sync();
		} finally {
			await file.close();
		}
		await rename(temp, path);
	} finally {
		await unlink(temp).catch(() => {});
	}
}

export class TurnFileCheckpoints {
	private readonly captures = new Map<string, ActiveCapture>();
	private previewed?: { preview: TurnFileRestorePreview; checkpoint: Checkpoint };
	private applying = false;
	private disposed = false;

	constructor(
		private readonly path: string,
		private readonly cwd: string,
		private readonly busy: () => boolean,
	) {}

	get isRestoring(): boolean {
		return this.applying;
	}

	dispose(): void {
		this.disposed = true;
		for (const capture of this.captures.values()) {
			capture.overlapped = true;
			activeCaptures.delete(capture);
		}
		this.captures.clear();
		this.previewed = undefined;
	}

	private async read(): Promise<Checkpoint[]> {
		try {
			const file = await open(this.path, "r");
			try {
				if ((await file.stat()).size > MAX_STORE_BYTES)
					throw new Error("Turn checkpoint store exceeds its size limit");
				return storeSchema.parse(JSON.parse(await file.readFile("utf8"))).checkpoints;
			} finally {
				await file.close();
			}
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
			throw error;
		}
	}

	async observe(event: StoredSessionEvent, signal: AbortSignal): Promise<void> {
		if (event.type === "turn.started") {
			await this.start(event.turnId, event.timestamp, signal);
			return;
		}
		if (!event.turnId) return;
		const capture = this.captures.get(event.turnId);
		if (!capture) return;
		if (event.type === "message.appended" && !capture.title && event.message.role === "user") {
			const { content } = event.message;
			capture.title = (
				typeof content === "string"
					? content
					: content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ")
			).slice(0, 100);
		}
		if (
			event.type === "turn.completed" ||
			event.type === "turn.cancelled" ||
			event.type === "turn.failed" ||
			event.type === "turn.transferred"
		) {
			try {
				if (capture.before && !capture.overlapped) await this.finish(event.turnId, capture);
			} finally {
				this.captures.delete(event.turnId);
				activeCaptures.delete(capture);
			}
		}
	}

	private async start(turnId: string, timestamp: number, signal: AbortSignal): Promise<void> {
		if (!isAbsolute(this.cwd) || this.captures.has(turnId)) return;
		const root = await realpath(this.cwd).catch(() => undefined);
		if (!root) return;
		for (const [path, done] of activeRestores) if (overlaps(path, root)) await done;
		if (this.disposed) return;
		const capture: ActiveCapture = { root, timestamp, title: "", overlapped: false };
		for (const active of activeCaptures) {
			if (!overlaps(active.root, root)) continue;
			active.overlapped = true;
			capture.overlapped = true;
		}
		this.captures.set(turnId, capture);
		activeCaptures.add(capture);
		if (!capture.overlapped) capture.before = await captureWorkspace(root, undefined, signal).catch(() => undefined);
	}

	private async finish(turnId: string, capture: ActiveCapture): Promise<void> {
		const before = capture.before;
		if (!before) return;
		const after = await captureWorkspace(capture.root, before).catch(() => undefined);
		if (!after || capture.overlapped) return;
		const files = changedFiles(before, after);
		if (!files.length || files.length > MAX_CHANGES) return;
		const { title, timestamp, root } = capture;
		const next = { turnId, title, timestamp, root, identity: after.identity, files };
		if (Buffer.byteLength(formatStore([next])) > MAX_STORE_BYTES) return;
		const checkpoints = [next, ...(await this.read()).filter((item) => item.turnId !== turnId)].slice(
			0,
			MAX_CHECKPOINTS,
		);
		if (capture.overlapped) return;
		let content = formatStore(checkpoints);
		while (Buffer.byteLength(content) > MAX_STORE_BYTES) {
			checkpoints.pop();
			content = formatStore(checkpoints);
		}
		await writeStore(this.path, content);
	}

	async list(): Promise<TurnFilesSummary[]> {
		return (await this.read()).map(({ turnId, title, timestamp, files }) => ({
			turnId,
			title,
			timestamp,
			fileCount: files.length,
		}));
	}

	private async workspaceMatches(checkpoint: Checkpoint): Promise<boolean> {
		try {
			return (
				(await realpath(this.cwd)) === checkpoint.root &&
				(await workspaceIdentity(checkpoint.root)) === checkpoint.identity
			);
		} catch {
			return false;
		}
	}

	private canRestore(root: string): boolean {
		return !this.disposed && !this.busy() && ![...activeCaptures].some((capture) => overlaps(capture.root, root));
	}

	private async status(checkpoint: Checkpoint, file: FileChange): Promise<TurnFileRestoreEntry["status"]> {
		if (file.before === "unsupported" || file.after === "unsupported") return "unavailable";
		try {
			const target = snapshotPath(checkpoint.root, file.path);
			if (!(await checkedParent(checkpoint.root, target)) && !file.missingParent) return "unavailable";
			const current = await readFileState(checkpoint.root, target);
			if (sameFileState(current, file.before)) return "restored";
			return sameFileState(current, file.after) ? "ready" : "conflict";
		} catch {
			return "conflict";
		}
	}

	async preview(turnId: string): Promise<TurnFileRestorePreview> {
		const checkpoint = (await this.read()).find((item) => item.turnId === turnId);
		if (!checkpoint) throw new Error("Turn checkpoint is unavailable");
		const available = await this.workspaceMatches(checkpoint);
		const files: TurnFileRestoreEntry[] = [];
		for (const file of checkpoint.files) {
			files.push({
				path: file.path,
				change: summarizeChange(file.before, file.after),
				status: available ? await this.status(checkpoint, file) : "unavailable",
			});
		}
		const preview = { previewId: randomUUID(), files };
		if (available && this.canRestore(checkpoint.root) && !this.applying) this.previewed = { preview, checkpoint };
		else {
			this.previewed = undefined;
			return {
				...preview,
				files: files.map((file) => (file.status === "ready" ? { ...file, status: "unavailable" } : file)),
			};
		}
		return preview;
	}

	async restore(previewId: string): Promise<TurnFileRestoreEntry[]> {
		const plan = this.previewed;
		if (!plan || plan.preview.previewId !== previewId || this.applying)
			throw new Error("Refresh the turn file preview before restoring");
		const { checkpoint, preview } = plan;
		if (!this.canRestore(checkpoint.root) || isTurnFileRestoreActive(checkpoint.root))
			throw new Error("Wait for the active task before restoring files");
		this.applying = true;
		this.previewed = undefined;
		let release = () => {};
		activeRestores.set(
			checkpoint.root,
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		try {
			if (!(await this.workspaceMatches(checkpoint))) throw new Error("Checkpoint workspace changed");
			const results: TurnFileRestoreEntry[] = [];
			for (const [index, file] of checkpoint.files.entries()) {
				const entry = preview.files[index];
				if (entry.status !== "ready" || file.before === "unsupported" || file.after === "unsupported") {
					results.push(entry);
					continue;
				}
				const status = await this.status(checkpoint, file);
				if (status !== "ready") {
					results.push({ ...entry, status });
					continue;
				}
				const restored = await restoreFileState(
					checkpoint.root,
					snapshotPath(checkpoint.root, file.path),
					file.after,
					file.before,
					() => (this.disposed ? Promise.resolve(false) : this.workspaceMatches(checkpoint)),
					file.missingParent === true,
				).catch(() => false);
				results.push({ ...entry, status: restored ? "restored" : "conflict" });
			}
			return results;
		} finally {
			activeRestores.delete(checkpoint.root);
			release();
			this.applying = false;
		}
	}
}
