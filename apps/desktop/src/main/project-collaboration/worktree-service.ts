import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rmdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { isSshProjectUri } from "@567agent/ssh-transport";
import type {
	ManagedWorktreeActionResult,
	ManagedWorktreeErrorCode,
	ManagedWorktreeInfo,
	ManagedWorktreeRecord,
	ProjectCollaborationWorktreesState,
} from "../../shared/project-collaboration.js";
import { acquireManagedWorktreeRemoval } from "../conversations/managed-worktree-placement.js";
import { isTurnFileRestoreActive } from "../conversations/turn-file-checkpoints.js";
import { MAX_COLLABORATION_MEMBERS } from "./limits.js";
import {
	createGitWorktree,
	inspectWorktreeGit,
	isRegisteredGitWorktree,
	ManagedWorktreeGitError,
	readGitWorktreeStatus,
	removeGitWorktree,
} from "./worktree-git.js";
import {
	isPathInsideWorktree,
	isSameWorktreePath,
	parseManagedWorktreePath,
	resolveManagedWorktreeRoot,
} from "./worktree-layout.js";

interface WorktreePort {
	read(project: string): Promise<readonly ManagedWorktreeRecord[]>;
	add(project: string, record: ManagedWorktreeRecord): Promise<void>;
	forget(project: string, record: ManagedWorktreeRecord): Promise<void>;
	createSession(cwd: string, project: string): Promise<{ readonly sessionId: string; readonly sessionPath: string }>;
	isBusy(project: string, record: ManagedWorktreeRecord): Promise<boolean>;
}

function failure(code: ManagedWorktreeErrorCode, changedPreview?: readonly string[]): ManagedWorktreeActionResult {
	return { ok: false, error: { code, ...(changedPreview ? { changedPreview } : {}) } };
}

export class ManagedWorktreeService {
	constructor(
		private readonly port: WorktreePort,
		private readonly managedRoot = () => resolveManagedWorktreeRoot(getAgent567HomePath()),
	) {}

	private async root(): Promise<string> {
		const root = this.managedRoot();
		const info = await lstat(root).catch((error: unknown) => {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
			throw error;
		});
		if (!info) return root;
		if (!info.isDirectory() || info.isSymbolicLink()) throw new ManagedWorktreeGitError("not-managed");
		return realpath(root);
	}

	private async state(project: string, record: ManagedWorktreeRecord): Promise<ManagedWorktreeInfo> {
		const inUse = (await this.port.isBusy(project, record).catch(() => true)) || isTurnFileRestoreActive(record.path);
		const status = await this.status(project, record).catch(() => undefined);
		return {
			...record,
			state: status === null ? "missing" : "ok",
			dirty: status === null ? false : status ? status.changed.length > 0 || status.hasUniqueCommits : null,
			inUse,
		};
	}

	private async status(project: string, record: ManagedWorktreeRecord) {
		const root = await this.root();
		const parsed = parseManagedWorktreePath(root, record.path);
		if (!parsed || parsed.relativePath || !isPathInsideWorktree(record.path, record.cwd))
			throw new ManagedWorktreeGitError("not-managed");
		const info = await lstat(record.path).catch((error: unknown) => {
			if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
			throw error;
		});
		if (!info) return null;
		if (
			!info.isDirectory() ||
			!isSameWorktreePath(record.path, await realpath(record.path)) ||
			!(await isRegisteredGitWorktree(project, record.path))
		)
			throw new ManagedWorktreeGitError("not-managed");
		return readGitWorktreeStatus(record.path, project, record.baseCommit);
	}

	async list(project: string): Promise<ProjectCollaborationWorktreesState> {
		if (isSshProjectUri(project)) return { supported: false, worktrees: [] };
		const [source, records] = await Promise.all([
			inspectWorktreeGit(project).catch(() => undefined),
			this.port.read(project),
		]);
		const worktrees = await Promise.all(records.map((record) => this.state(project, record)));
		return { supported: Boolean(source?.head), worktrees };
	}

	async create(project: string, startRef?: string): Promise<ManagedWorktreeActionResult> {
		if (isSshProjectUri(project)) return failure("unsupported-remote");
		let worktree: string | undefined;
		let created = false;
		let recorded = false;
		try {
			if ((await this.port.read(project)).length >= MAX_COLLABORATION_MEMBERS) return failure("limit-reached");
			const source = await inspectWorktreeGit(project);
			await mkdir(this.managedRoot(), { recursive: true, mode: 0o700 });
			const root = await this.root();
			const id = randomUUID();
			const bucket = join(root, id.slice(0, 4));
			const name =
				basename(source.root)
					.replace(/[^a-zA-Z0-9_-]+/g, "-")
					.slice(0, 36) || "workspace";
			worktree = join(bucket, `${name}-${id.slice(4, 8)}-${id.slice(-8)}`);
			await mkdir(bucket, { recursive: true });
			if (!isSameWorktreePath(bucket, await realpath(bucket))) return failure("not-managed");
			const baseCommit = await createGitWorktree(project, worktree, startRef);
			created = true;
			const cwd = join(worktree, source.relativeCwd);
			const session = await this.port.createSession(cwd, project);
			await this.port.add(project, {
				path: worktree,
				cwd,
				baseCommit,
				sessionId: session.sessionId,
				sessionPath: session.sessionPath,
			});
			recorded = true;
			return { ok: true, snapshot: await this.list(project) };
		} catch (error) {
			if (created && !recorded && worktree) await removeGitWorktree(project, worktree).catch(() => undefined);
			return failure(error instanceof ManagedWorktreeGitError ? error.code : "git-failed");
		} finally {
			if (worktree && !recorded) await rmdir(join(worktree, "..")).catch(() => undefined);
		}
	}

	async remove(project: string, path: string): Promise<ManagedWorktreeActionResult> {
		const record = (await this.port.read(project)).find((item) => isSameWorktreePath(item.path, path));
		if (!record) return failure("not-managed");
		const release = acquireManagedWorktreeRemoval(record.path);
		if (!release) return failure("worktree-in-use");
		try {
			if ((await this.port.isBusy(project, record).catch(() => true)) || isTurnFileRestoreActive(record.path))
				return failure("worktree-in-use");
			const status = await this.status(project, record);
			if (status?.changed.length || status?.hasUniqueCommits)
				return failure("worktree-dirty", status.changed.slice(0, 20));
			if (status) await removeGitWorktree(project, record.path);
			await this.port.forget(project, record);
			return { ok: true, snapshot: await this.list(project) };
		} catch (error) {
			return failure(error instanceof ManagedWorktreeGitError ? error.code : "git-failed");
		} finally {
			release();
		}
	}
}
