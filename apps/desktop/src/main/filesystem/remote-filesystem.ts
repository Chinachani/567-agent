import { posix } from "node:path";
import {
	formatSshProjectUri,
	normalizeRemotePath,
	parseProjectLocation,
	SshHelperError,
	SshRemoteCommandError,
} from "@567agent/ssh-transport";
import {
	FILE_EXPLORER_ENTRY_EXISTS_ERROR,
	getFileExplorerEntryNameIssue,
} from "../../preload/file-explorer-entry-name.js";
import {
	type FileExplorerEntryKind,
	FS_EDITABLE_TEXT_ERROR,
	type FsEditableTextSnapshot,
	type FsEntry,
	type FsFileRef,
	type FsSaveEditableTextOptions,
	type FsSaveEditableTextResult,
	type FsStatResult,
} from "../../preload/fs-types.js";
import { getSshConnection } from "../ssh/ssh-runtime.js";
import {
	decodeEditableText,
	encodeEditableText,
	getFileRevision,
	MAX_EDITABLE_TEXT_FILE_SIZE,
} from "./editable-text.js";
import type { PreviewFileSource } from "./preview-file-source.js";

/**
 * 远程项目的文件读写。
 *
 * 授权根与本地那套分开维护：本地用 `resolve()` 归一化并按本机大小写规则比较，
 * 远端路径永远是 POSIX 且大小写敏感，混在一起会让 `/srv/App` 和 `/srv/app`
 * 互相授权。键是完整的 `ssh://<hostId>/<路径>`，所以主机也天然参与了比较。
 */
const allowedRemoteRoots = new Set<string>();

export function allowRemoteProjectRoot(projectUri: string): void {
	allowedRemoteRoots.add(normalizeRemoteUri(projectUri));
}

/** 远端路径的授权检查：必须落在某个已登记的远程项目根之下。 */
export function assertRemotePathWithinProject(uri: string): void {
	const target = normalizeRemoteUri(uri);
	// 前缀比较看不出 `..`：`<项目>/../../etc/passwd` 字面上仍以项目根开头。合法调用方给的
	// 都是文件树里点出来的路径，不会带 `..`，直接拒绝比在这里模拟远端的路径解析可靠。
	if (split(uri).remotePath.split("/").includes("..")) {
		throw new Error("Path is outside any known project directory");
	}
	for (const root of allowedRemoteRoots) {
		if (target === root || target.startsWith(`${root.replace(/\/$/, "")}/`)) return;
	}
	throw new Error("Path is outside any known project directory");
}

/** Resolve every I/O target against the canonical version of its registered project root. */
export async function resolveRemoteProjectPath(uri: string, allowMissing = false): Promise<string> {
	assertRemotePathWithinProject(uri);
	const target = normalizeRemoteUri(uri);
	const { hostId, remotePath } = split(target);
	if (remotePath.includes("\0")) throw new Error("Invalid remote path");
	const connection = getSshConnection(hostId);
	const canonical = async (path: string, missing: boolean): Promise<string> => {
		try {
			return await connection.realPath(path, undefined, { strict: true });
		} catch (error) {
			if (
				!missing ||
				!(error instanceof SshHelperError || error instanceof SshRemoteCommandError) ||
				error.code !== "ENOENT" ||
				path === "/"
			)
				throw error;
			// A missing leaf may be created, but an existing symlink must never fall back to a lexical path.
			if (await connection.stat(path)) throw error;
			return posix.join(await canonical(posix.dirname(path), true), posix.basename(path));
		}
	};
	const real = await canonical(remotePath, allowMissing);
	for (const root of allowedRemoteRoots) {
		if (target !== root && !target.startsWith(`${root.replace(/\/$/, "")}/`)) continue;
		const realRoot = await canonical(split(root).remotePath, false);
		const relative = posix.relative(realRoot, real);
		if (relative === "" || (relative !== ".." && !relative.startsWith("../") && !posix.isAbsolute(relative)))
			return formatSshProjectUri(hostId, real);
	}
	throw new Error("Path is outside any known project directory");
}

/** Renaming/removing a symlink must operate on the link, never its resolved target. */
async function resolveRemoteEntryPath(uri: string, allowMissing = false): Promise<string> {
	await resolveRemoteProjectPath(uri, allowMissing);
	const { hostId, remotePath } = split(uri);
	const parent = await resolveRemoteProjectPath(formatSshProjectUri(hostId, posix.dirname(remotePath)));
	return formatSshProjectUri(hostId, posix.join(split(parent).remotePath, posix.basename(remotePath)));
}

/** File-tree mutations may not remove a registered project through an alias or an ancestor. */
async function assertMutableRemoteEntry(uri: string, allowMissing = false): Promise<void> {
	const target = split(await resolveRemoteProjectPath(uri, allowMissing));
	const connection = getSshConnection(target.hostId);
	for (const uriRoot of allowedRemoteRoots) {
		const root = split(uriRoot);
		if (root.hostId !== target.hostId) continue;
		const canonicalRoot = await connection.realPath(root.remotePath, undefined, { strict: true });
		const relative = posix.relative(target.remotePath, canonicalRoot);
		if (relative === "" || (relative !== ".." && !relative.startsWith("../") && !posix.isAbsolute(relative))) {
			throw new Error("Refusing to replace or remove a registered project root");
		}
	}
}

/** 归一化远端 URI，去掉重复斜杠与结尾斜杠，保证前缀比较不会因写法不同而失效。 */
function normalizeRemoteUri(uri: string): string {
	const location = parseProjectLocation(uri);
	if (location.kind !== "ssh") throw new Error(`Not a remote path: ${uri}`);
	return formatSshProjectUri(location.hostId, location.remotePath);
}

function split(uri: string): { hostId: string; remotePath: string } {
	const location = parseProjectLocation(uri);
	if (location.kind !== "ssh") throw new Error(`Not a remote path: ${uri}`);
	return { hostId: location.hostId, remotePath: location.remotePath };
}

const HIDDEN_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

export async function readRemoteDirectory(uri: string): Promise<FsEntry[]> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(await resolveRemoteProjectPath(uri));
	const entries = await getSshConnection(hostId).listDirectory(remotePath);
	const results: FsEntry[] = [];
	for (const entry of entries) {
		if (HIDDEN_FILES.has(entry.name) || entry.name.startsWith(".")) continue;
		results.push({
			name: entry.name,
			// 回给渲染进程的仍是 URI：文件树拿它继续展开下一层，也用它做选中态的 key。
			path: formatSshProjectUri(hostId, `${split(uri).remotePath}/${entry.name}`),
			isDirectory: entry.kind === "directory",
			size: entry.sizeBytes,
			// 远端给的是秒，本地这套接口一律用毫秒。
			modifiedAt: entry.modifiedAtSeconds * 1000,
		});
	}
	results.sort((a, b) => {
		if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
		return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
	});
	return results;
}

export async function statRemotePath(uri: string): Promise<FsStatResult | null> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(await resolveRemoteProjectPath(uri));
	const entry = await getSshConnection(hostId).stat(remotePath);
	if (!entry) return null;
	return {
		size: entry.sizeBytes,
		modifiedAt: entry.modifiedAtSeconds * 1000,
		// 远端的 stat 不回创建时间：Linux 上多数文件系统根本不记录它。
		// 用修改时间兜底，而不是给 0——0 会被界面显示成 1970 年。
		createdAt: entry.modifiedAtSeconds * 1000,
	};
}

export async function readRemoteEditableTextFile(uri: string): Promise<FsEditableTextSnapshot> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(await resolveRemoteProjectPath(uri));
	const connection = getSshConnection(hostId);
	const entry = await connection.stat(remotePath);
	if (!entry) throw new Error(FS_EDITABLE_TEXT_ERROR.NOT_FILE);
	if (entry.kind !== "file") throw new Error(FS_EDITABLE_TEXT_ERROR.NOT_FILE);
	// 先按远端报的大小挡一次，避免把一个几百兆的文件整个拖过网络再拒绝。
	if (entry.sizeBytes > MAX_EDITABLE_TEXT_FILE_SIZE) throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
	const buffer = Buffer.from(await connection.readFileHead(remotePath, MAX_EDITABLE_TEXT_FILE_SIZE + 1));
	if (buffer.byteLength > MAX_EDITABLE_TEXT_FILE_SIZE) throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
	return {
		...decodeEditableText(buffer),
		revision: getFileRevision(buffer),
		size: buffer.byteLength,
		modifiedAt: entry.modifiedAtSeconds * 1000,
	};
}

export async function saveRemoteEditableTextFile(
	uri: string,
	content: string,
	options: FsSaveEditableTextOptions,
): Promise<FsSaveEditableTextResult> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(await resolveRemoteProjectPath(uri));
	const connection = getSshConnection(hostId);
	// 覆盖前重新读一遍算修订号：这是「别人动过没有」的唯一依据，不能用打开时的快照。
	const current = Buffer.from(await connection.readFileHead(remotePath, MAX_EDITABLE_TEXT_FILE_SIZE + 1));
	if (current.byteLength > MAX_EDITABLE_TEXT_FILE_SIZE) throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
	const currentRevision = getFileRevision(current);
	if (!options.force && currentRevision !== options.expectedRevision) {
		return { status: "conflict", revision: currentRevision };
	}

	const nextBuffer = encodeEditableText(content, options.hasBom);
	if (nextBuffer.byteLength > MAX_EDITABLE_TEXT_FILE_SIZE) throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
	try {
		await connection.writeFile(remotePath, nextBuffer, undefined, {
			expectedRevision: options.force ? undefined : options.expectedRevision,
		});
	} catch (error) {
		if (!(error instanceof SshHelperError || error instanceof SshRemoteCommandError)) throw error;
		if (error.code === "ENOTSUP") throw new Error(FS_EDITABLE_TEXT_ERROR.CHECKED_SAVE_UNAVAILABLE);
		if (error.code !== "ECONFLICT") throw error;
		const latest = Buffer.from(await connection.readFileHead(remotePath, MAX_EDITABLE_TEXT_FILE_SIZE + 1));
		if (latest.byteLength > MAX_EDITABLE_TEXT_FILE_SIZE) throw new Error(FS_EDITABLE_TEXT_ERROR.TOO_LARGE);
		return { status: "conflict", revision: getFileRevision(latest) };
	}
	const entry = await connection.stat(remotePath);
	return {
		status: "saved",
		revision: getFileRevision(nextBuffer),
		size: nextBuffer.byteLength,
		modifiedAt: (entry?.modifiedAtSeconds ?? 0) * 1000,
	};
}

/** 预览读取的远端字节来源，见 filesystem-service 的 {@link PreviewFileSource}。 */
export function openRemotePreviewSource(uri: string): PreviewFileSource {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(uri);
	const connection = getSshConnection(hostId);
	const authorizedPath = async (): Promise<string> => split(await resolveRemoteProjectPath(uri)).remotePath;
	return {
		path: remotePath,
		stat: async () => {
			const entry = await connection.stat(await authorizedPath(), undefined, { followSymlinks: true });
			return entry
				? { size: entry.sizeBytes, isFile: entry.kind === "file", modifiedAt: entry.modifiedAtSeconds * 1000 }
				: null;
		},
		read: async () => Buffer.from(await connection.readFile(await authorizedPath())),
		readHead: async (byteCount) => Buffer.from(await connection.readFileHead(await authorizedPath(), byteCount)),
	};
}

export async function writeRemoteFile(uri: string, content: Buffer): Promise<void> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(await resolveRemoteProjectPath(uri, true));
	const connection = getSshConnection(hostId);
	await connection.makeDirectory(posix.dirname(remotePath));
	await connection.writeFile(remotePath, content);
}

export async function renameRemotePath(oldUri: string, newUri: string): Promise<void> {
	assertRemotePathWithinProject(oldUri);
	assertRemotePathWithinProject(newUri);
	await assertMutableRemoteEntry(oldUri);
	await assertMutableRemoteEntry(newUri, true);
	const from = split(await resolveRemoteEntryPath(oldUri));
	const to = split(await resolveRemoteEntryPath(newUri, true));
	assertSameHost(from.hostId, to.hostId);
	await getSshConnection(from.hostId).rename(from.remotePath, to.remotePath);
}

export async function deleteRemotePath(uri: string): Promise<void> {
	assertRemotePathWithinProject(uri);
	// 项目根本身不能从文件树里删：那等于远程执行 rm -rf <项目>。
	await assertMutableRemoteEntry(uri);
	const { hostId, remotePath } = split(await resolveRemoteEntryPath(uri));
	await getSshConnection(hostId).remove(remotePath);
}

export async function moveRemotePath(sourceUri: string, destinationDirectoryUri: string): Promise<void> {
	assertRemotePathWithinProject(sourceUri);
	assertRemotePathWithinProject(destinationDirectoryUri);
	await assertMutableRemoteEntry(sourceUri);
	const source = split(await resolveRemoteEntryPath(sourceUri));
	const destination = split(await resolveRemoteProjectPath(destinationDirectoryUri));
	assertSameHost(source.hostId, destination.hostId);
	const target = posix.join(destination.remotePath, posix.basename(source.remotePath));
	// 本机实现用 rename，目标已存在时会覆盖文件、对非空目录报错；远端的 mv 会把源**移进**
	// 同名目录里。两边行为对不齐，干脆在目标已存在时拒绝。
	if (await getSshConnection(source.hostId).stat(target)) throw new Error(FILE_EXPLORER_ENTRY_EXISTS_ERROR);
	await getSshConnection(source.hostId).rename(source.remotePath, target);
}

export async function createRemoteDirectory(uri: string): Promise<void> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(await resolveRemoteProjectPath(uri, true));
	await getSshConnection(hostId).makeDirectory(remotePath);
}

export async function createRemoteEntry(
	parentUri: string,
	name: string,
	kind: FileExplorerEntryKind,
): Promise<FsEntry> {
	assertRemotePathWithinProject(parentUri);
	// 远端一律按 POSIX 规则校验名字，与本机是不是 Windows 无关。
	const issue = getFileExplorerEntryNameIssue(name, { windows: false });
	if (issue) throw new Error(`FILE_EXPLORER_INVALID_ENTRY_NAME:${issue}`);
	const { hostId, remotePath } = split(await resolveRemoteProjectPath(parentUri));
	const targetPath = posix.join(remotePath, name);
	if (posix.dirname(targetPath) !== normalizeRemotePath(remotePath)) {
		throw new Error("FILE_EXPLORER_INVALID_ENTRY_NAME:path-separator");
	}
	const connection = getSshConnection(hostId);
	if ((await connection.createEntry(targetPath, kind)) === "exists") throw new Error(FILE_EXPLORER_ENTRY_EXISTS_ERROR);
	const entry = await connection.stat(targetPath);
	return {
		name,
		path: formatSshProjectUri(hostId, posix.join(split(parentUri).remotePath, name)),
		isDirectory: kind === "directory",
		size: entry?.sizeBytes ?? 0,
		modifiedAt: (entry?.modifiedAtSeconds ?? 0) * 1000,
	};
}

export async function listRemoteFilesRecursive(
	rootUri: string,
	options: {
		readonly ignoredDirectoryNames: readonly string[];
		readonly limit: number;
		readonly names?: readonly string[];
		readonly includeDirectories?: boolean;
	},
): Promise<FsFileRef[]> {
	assertRemotePathWithinProject(rootUri);
	const { hostId, remotePath } = split(await resolveRemoteProjectPath(rootUri));
	const relativePaths = await getSshConnection(hostId).listFilesRecursive(remotePath, options);
	return relativePaths.map((relPath) => {
		const isDirectory = relPath.endsWith("/");
		const normalized = isDirectory ? relPath.replace(/\/+$/, "") : relPath;
		return {
			name: posix.basename(normalized),
			path: formatSshProjectUri(hostId, posix.join(split(rootUri).remotePath, normalized)),
			relPath: normalized,
			...(isDirectory ? { isDirectory: true } : {}),
		};
	});
}

function assertSameHost(first: string, second: string): void {
	if (first !== second) throw new Error("Cannot move files between different remote hosts");
}

/** 远端媒体按这个粒度分块取回：一块一次往返，太小拖慢播放，太大让拖动进度条变迟钝。 */
const REMOTE_MEDIA_CHUNK_BYTES = 1024 * 1024;

export interface RemoteMediaSource {
	/** 远端路径，用来取扩展名判断 Content-Type。 */
	readonly path: string;
	readonly size: number;
	/** `[start, end]` 闭区间，与 HTTP Range 同义。 */
	stream(start: number, end: number): ReadableStream<Uint8Array>;
}

/** 媒体协议的远端字节来源；路径不存在或不是文件时返回 null。 */
export async function openRemoteMediaSource(uri: string): Promise<RemoteMediaSource | null> {
	assertRemotePathWithinProject(uri);
	const { hostId, remotePath } = split(await resolveRemoteProjectPath(uri));
	const connection = getSshConnection(hostId);
	const entry = await connection.stat(remotePath, undefined, { followSymlinks: true });
	if (!entry || entry.kind !== "file") return null;
	return {
		path: remotePath,
		size: entry.sizeBytes,
		stream(start, end) {
			if (
				!Number.isSafeInteger(start) ||
				!Number.isSafeInteger(end) ||
				start < 0 ||
				end < start ||
				end >= entry.sizeBytes
			)
				throw new Error("Invalid remote media range");
			let offset = start;
			const abort = new AbortController();
			return new ReadableStream<Uint8Array>({
				// 按需取块：播放器暂停或跳走时不会继续把后面的内容拖过网络。
				async pull(controller) {
					if (offset > end) {
						controller.close();
						return;
					}
					const length = Math.min(REMOTE_MEDIA_CHUNK_BYTES, end - offset + 1);
					const chunk = await connection.readFileRange(remotePath, offset, length, abort.signal);
					if (abort.signal.aborted) return;
					if (chunk.byteLength !== length) throw new Error("Remote media changed during streaming");
					offset += chunk.byteLength;
					controller.enqueue(chunk);
				},
				cancel() {
					abort.abort();
				},
			});
		},
	};
}
