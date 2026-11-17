import { type ChildProcess, spawn } from "node:child_process";
import { lstat, mkdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { killNodeProcessTree } from "@567agent/runtime-node/coding";
import { mainT } from "../i18n/index.js";
import { getAppLogger } from "../logger.js";

const log = getAppLogger("project-clone");
export const PROJECT_CLONE_CHANNELS = {
	CLONE: "vetta:project:clone",
	CANCEL: "vetta:project:clone-cancel",
} as const;
export type ProjectCloneErrorCode =
	| "git-unavailable"
	| "invalid-url"
	| "invalid-target"
	| "target-exists"
	| "clone-failed"
	| "cancelled";
export interface ProjectCloneInput {
	requestId: string;
	url: string;
	parentDir: string;
}
export type ProjectCloneResult =
	| { path: string; name: string }
	| { error: { code: ProjectCloneErrorCode; message: string } };
const URL_SCHEME_RE = /^(https?|ssh|git|file):\/\/\S+$/i;
const SCP_LIKE_RE = /^[\w.-]+@[\w.-]+:\S+$/;
export function isCloneableRepoUrl(url: string): boolean {
	return (
		!!url &&
		!url.startsWith("-") &&
		!/[\x00-\x1f\x7f]/.test(url) &&
		(URL_SCHEME_RE.test(url) || SCP_LIKE_RE.test(url) || isAbsolute(url))
	);
}
export function deriveRepoDirName(url: string): string | null {
	let path = url;
	if (URL_SCHEME_RE.test(url)) {
		try {
			path = decodeURIComponent(new URL(url).pathname);
		} catch {
			return null;
		}
	}
	const name = (
		path
			.trim()
			.replace(/[/\\]+$/, "")
			.split(/[/\\:]/)
			.pop() ?? ""
	).replace(/\.git$/i, "");
	if (
		!name ||
		name === "." ||
		name === ".." ||
		/[/\\:*?"<>|\x00-\x1f\x7f]/.test(name) ||
		/[. ]$/.test(name) ||
		/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
	)
		return null;
	return name;
}
interface CloneTask {
	cancelled: boolean;
	child?: ChildProcess;
}
const running = new Map<string, CloneTask>();
function fail(code: ProjectCloneErrorCode): ProjectCloneResult {
	return { error: { code, message: mainT(`projectClone.${code}`) } };
}

export async function cloneProject(input: ProjectCloneInput): Promise<ProjectCloneResult> {
	if (!input.requestId || running.has(input.requestId)) return fail("clone-failed");
	const url = input.url.trim();
	const name = deriveRepoDirName(url);
	if (!isCloneableRepoUrl(url) || !name) return fail("invalid-url");
	if (!isAbsolute(input.parentDir)) return fail("invalid-target");
	const task: CloneTask = { cancelled: false };
	running.set(input.requestId, task);
	const target = join(input.parentDir, name);
	let owned: { dev: number; ino: number } | undefined;
	let completed = false;
	try {
		if (!(await stat(input.parentDir).catch(() => null))?.isDirectory()) return fail("invalid-target");
		if (task.cancelled) return fail("cancelled");
		// Exclusive creation owns this directory; never delete a pre-existing target.
		try {
			await mkdir(target);
		} catch (error) {
			return fail((error as NodeJS.ErrnoException).code === "EEXIST" ? "target-exists" : "invalid-target");
		}
		owned = await lstat(target);
		if (task.cancelled) return fail("cancelled");
		const result = await new Promise<ProjectCloneResult>((resolve) => {
			let spawnError: NodeJS.ErrnoException | undefined;
			try {
				task.child = spawn("git", ["clone", "--progress", "--", url, target], {
					stdio: "ignore",
					windowsHide: true,
					detached: process.platform !== "win32",
					env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" },
				});
			} catch {
				resolve(fail("clone-failed"));
				return;
			}
			// Wait for close (including stdio) before cleanup, even when spawn emits error.
			task.child.once("error", (error) => {
				spawnError = error;
			});
			task.child.once("close", (code) => {
				if (task.cancelled) resolve(fail("cancelled"));
				else if (spawnError?.code === "ENOENT") resolve(fail("git-unavailable"));
				else if (!spawnError && code === 0) resolve({ path: target, name });
				else {
					log.warn("git clone failed", { exitCode: code, errorCode: spawnError?.code });
					resolve(fail("clone-failed"));
				}
			});
		});
		completed = !("error" in result);
		return result;
	} catch {
		return fail(task.cancelled ? "cancelled" : "clone-failed");
	} finally {
		if (owned && !completed) {
			const current = await lstat(target).catch(() => null);
			if (current?.dev === owned.dev && current.ino === owned.ino && current.isDirectory()) {
				await rm(target, { recursive: true, force: true }).catch(() =>
					log.warn("Unable to remove incomplete clone"),
				);
			}
		}
		if (running.get(input.requestId) === task) running.delete(input.requestId);
	}
}
export function cancelClone(requestId: string): void {
	const task = running.get(requestId);
	if (!task) return;
	task.cancelled = true;
	if (task.child?.pid) killNodeProcessTree(task.child.pid);
}
export function cancelAllClones(): void {
	for (const requestId of running.keys()) cancelClone(requestId);
}
