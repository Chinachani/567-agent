import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const run = promisify(execFile);
const MAX_FILES = 5_000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024;
const PATH_BATCH = 24;

export const fileSnapshotSchema = z.object({
	content: z.base64().max(Math.ceil(MAX_FILE_BYTES / 3) * 4),
	mode: z.number().int().min(0).max(0o777),
});
export type FileSnapshot = z.infer<typeof fileSnapshotSchema>;
export type FileState = FileSnapshot | null | "unsupported";
export interface WorkspaceSnapshot {
	root: string;
	identity: string;
	files: ReadonlyMap<string, FileState>;
	ignored: ReadonlySet<string>;
	missingParents: ReadonlySet<string>;
}

function isMissing(error: unknown) {
	return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function containsPath(root: string, path: string): boolean {
	const part = relative(root, path);
	return part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part);
}

export function snapshotPath(root: string, path: string): string {
	const segments = path.split("/");
	if (
		isAbsolute(path) ||
		path.includes("\0") ||
		path.includes("\ufffd") ||
		(process.platform === "win32" && /[\\:]/.test(path)) ||
		segments.some((segment) => !segment || segment === "." || segment === ".." || /^\.git[ .]*$/i.test(segment))
	) {
		throw new Error("Invalid checkpoint file path");
	}
	const target = resolve(root, ...segments);
	if (!containsPath(root, target)) throw new Error("Checkpoint file is outside the workspace");
	return target;
}

export async function workspaceIdentity(root: string): Promise<string> {
	if ((await realpath(root)) !== root) throw new Error("Checkpoint workspace moved");
	const info = await stat(root, { bigint: true });
	if (!info.isDirectory()) throw new Error("Checkpoint workspace is unavailable");
	return `${info.dev}:${info.ino}`;
}

export async function checkedParent(root: string, target: string): Promise<boolean> {
	let ancestor = dirname(target);
	while (containsPath(root, ancestor)) {
		try {
			if ((await realpath(ancestor)) !== ancestor) throw new Error("Checkpoint file has an aliased parent");
			return ancestor === dirname(target);
		} catch (error) {
			if (!isMissing(error) || ancestor === root) throw error;
			ancestor = dirname(ancestor);
		}
	}
	throw new Error("Checkpoint parent is outside the workspace");
}

export async function readFileState(root: string, target: string): Promise<FileState> {
	try {
		if (!(await checkedParent(root, target))) return null;
		const before = await lstat(target);
		if (!before.isFile() || before.nlink !== 1 || before.size > MAX_FILE_BYTES) return "unsupported";
		const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
		try {
			const info = await handle.stat();
			if (!info.isFile() || info.dev !== before.dev || info.ino !== before.ino) return "unsupported";
			if (info.size > MAX_FILE_BYTES) return "unsupported";
			const bytes = Buffer.allocUnsafe(info.size + 1);
			const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
			const after = await lstat(target);
			if (
				bytesRead !== info.size ||
				after.dev !== info.dev ||
				after.ino !== info.ino ||
				after.mtimeMs !== info.mtimeMs ||
				after.ctimeMs !== info.ctimeMs ||
				!(await checkedParent(root, target))
			)
				return "unsupported";
			return { content: bytes.subarray(0, bytesRead).toString("base64"), mode: info.mode & 0o777 };
		} finally {
			await handle.close();
		}
	} catch (error) {
		return isMissing(error) ? null : "unsupported";
	}
}

export function sameFileState(left: FileState, right: FileState): boolean {
	if (!left || !right || left === "unsupported" || right === "unsupported") return left === right;
	return left.mode === right.mode && left.content === right.content;
}

export async function captureWorkspace(
	root: string,
	previous?: WorkspaceSnapshot,
	signal?: AbortSignal,
): Promise<WorkspaceSnapshot> {
	const identity = await workspaceIdentity(root);
	if (previous && previous.identity !== identity) throw new Error("Checkpoint workspace changed during the turn");
	const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)));
	const list = async (flags: string[]) => {
		const { stdout } = await run(
			"git",
			["-c", "core.fsmonitor=false", "ls-files", ...flags, "--exclude-standard", "-z", "--", "."],
			{ cwd: root, env: { ...env, GIT_OPTIONAL_LOCKS: "0" }, windowsHide: true, timeout: 4_000, signal },
		);
		return stdout.split("\0").filter(Boolean);
	};
	const [visible, ignored] = await Promise.all([
		list(["--cached", "--others"]),
		previous ? [] : list(["--others", "--ignored", "--directory"]),
	]);
	const paths = [...new Set([...(previous?.files.keys() ?? []), ...visible])];
	if (paths.length > MAX_FILES) throw new Error("Checkpoint workspace has too many files");
	const files = new Map<string, FileState>();
	const missingParents = new Set<string>();
	let bytes = 0;
	for (let index = 0; index < paths.length; index += PATH_BATCH) {
		signal?.throwIfAborted();
		const batch = await Promise.all(
			paths.slice(index, index + PATH_BATCH).map(async (path) => {
				let target: string;
				try {
					target = snapshotPath(root, path);
				} catch {
					return [path, "unsupported"] as const;
				}
				const state = await readFileState(root, target);
				if (
					state === null &&
					previous?.files.get(path) &&
					(await checkedParent(root, target).catch(() => true)) === false
				)
					missingParents.add(path);
				return [path, state] as const;
			}),
		);
		for (const [path, state] of batch) {
			if (state && state !== "unsupported") bytes += state.content.length;
			if (bytes > MAX_WORKSPACE_BYTES) throw new Error("Checkpoint workspace exceeds the capture limit");
			files.set(path, state);
		}
	}
	if (identity !== (await workspaceIdentity(root))) throw new Error("Checkpoint workspace changed during capture");
	return { root, identity, files, ignored: new Set(ignored), missingParents };
}

export async function restoreFileState(
	root: string,
	target: string,
	expected: FileSnapshot | null,
	restore: FileSnapshot | null,
	canWrite: () => Promise<boolean>,
	allowParentCreation: boolean,
): Promise<boolean> {
	const unchanged = async () => (await canWrite()) && sameFileState(await readFileState(root, target), expected);
	if (!(await checkedParent(root, target))) {
		if (!allowParentCreation || !restore || expected || !(await unchanged())) return false;
		const missing: string[] = [];
		for (let path = target; !(await checkedParent(root, path)); path = dirname(path)) missing.push(dirname(path));
		for (const path of missing.reverse()) {
			if (!(await canWrite()) || !(await checkedParent(root, path))) return false;
			await mkdir(path);
		}
	}
	if (!restore) {
		if (!(await unchanged())) return false;
		await unlink(target);
		return true;
	}
	const temp = resolve(dirname(target), `.agent567-restore-${randomUUID()}.tmp`);
	const file = await open(temp, "wx", 0o600);
	try {
		try {
			await file.writeFile(Buffer.from(restore.content, "base64"));
			await file.chmod(restore.mode);
			await file.sync();
		} finally {
			await file.close();
		}
		if (!(await unchanged())) return false;
		if (expected) await rename(temp, target);
		else await link(temp, target);
		return true;
	} finally {
		await unlink(temp).catch(() => {});
	}
}
