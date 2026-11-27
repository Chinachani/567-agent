import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, realpath, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import type { ManagedWorktreeErrorCode } from "../../shared/project-collaboration.js";

const exec = promisify(execFile);
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export class ManagedWorktreeGitError extends Error {
	constructor(readonly code: ManagedWorktreeErrorCode) {
		super(code);
	}
}

function baseEnv(): NodeJS.ProcessEnv {
	return {
		...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
		GIT_TERMINAL_PROMPT: "0",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
		GIT_ATTR_NOSYSTEM: "1",
		GIT_NO_LAZY_FETCH: "1",
		GIT_ALLOW_PROTOCOL: "",
	};
}

async function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
	const options = ["-c", "core.fsmonitor=false", "-c", "maintenance.auto=false", "-c", "gc.auto=0"];
	return (
		await exec("git", [...options, ...args], {
			cwd,
			env: { ...baseEnv(), ...env },
			timeout: 30_000,
			maxBuffer: 4 * 1024 * 1024,
			windowsHide: true,
		})
	).stdout;
}

function gitExit(error: unknown): unknown {
	return error instanceof Error && "code" in error ? error.code : undefined;
}

export async function inspectWorktreeGit(cwd: string) {
	try {
		const root = await realpath((await git(cwd, ["rev-parse", "--show-toplevel"])).trimEnd());
		const source = await realpath(cwd);
		const head = (await git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]).catch(() => "")).trim();
		return { root, source, relativeCwd: relative(root, source), head: oidPattern.test(head) ? head : null };
	} catch (error) {
		throw new ManagedWorktreeGitError(gitExit(error) === "ENOENT" ? "git-unavailable" : "not-repository");
	}
}

export async function createGitWorktree(cwd: string, target: string, startRef = "HEAD"): Promise<string> {
	const source = await inspectWorktreeGit(cwd);
	if (!startRef.trim() || startRef.startsWith("-") || /[\x00-\x1f\x7f]/.test(startRef))
		throw new ManagedWorktreeGitError("invalid-start-ref");
	const commit = (
		await git(cwd, ["rev-parse", "--verify", "--end-of-options", `${startRef}^{commit}`]).catch(() => "")
	).trim();
	if (!oidPattern.test(commit)) throw new ManagedWorktreeGitError("invalid-start-ref");
	if (source.relativeCwd) {
		const treePath = source.relativeCwd.split(sep).join("/");
		const kind = (await git(cwd, ["cat-file", "-t", `${commit}:${treePath}`]).catch(() => "")).trim();
		if (kind !== "tree") throw new ManagedWorktreeGitError("start-ref-missing-subdir");
	}
	const scratch = await mkdtemp(join(tmpdir(), "agent567-worktree-git-"));
	const hooks = join(scratch, "no-hooks");
	const isolatedMetadata = join(scratch, "git");
	const hookConfig = ["-c", `core.hooksPath=${hooks}`];
	let registered = false;
	try {
		await mkdir(hooks);
		const objects = (await git(cwd, ["rev-parse", "--path-format=absolute", "--git-path", "objects"])).trimEnd();
		const format = (await git(cwd, ["rev-parse", "--show-object-format"])).trim();
		if (format !== "sha1" && format !== "sha256") throw new ManagedWorktreeGitError("git-failed");
		await git(scratch, ["init", "--bare", "--quiet", "--template=", `--object-format=${format}`, isolatedMetadata]);
		await git(cwd, [...hookConfig, "worktree", "add", "--detach", "--no-checkout", "--", target, commit]);
		registered = true;
		const isolatedIndex = join(isolatedMetadata, "index");
		const prefix = [...hookConfig, `--git-dir=${isolatedMetadata}`, `--work-tree=${target}`];
		await git(target, [...prefix, "read-tree", "-m", "-u", commit], { GIT_OBJECT_DIRECTORY: objects });
		const liveIndex = (await git(target, ["rev-parse", "--path-format=absolute", "--git-path", "index"])).trimEnd();
		await copyFile(isolatedIndex, liveIndex);
		return commit;
	} catch (error) {
		if (registered) {
			await git(cwd, [...hookConfig, "worktree", "remove", "--force", "--", target]).catch(() => undefined);
		}
		throw error instanceof ManagedWorktreeGitError ? error : new ManagedWorktreeGitError("git-failed");
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

async function filterOverrides(cwd: string): Promise<string[]> {
	const names = await git(cwd, ["config", "--null", "--name-only", "--get-regexp", "^filter\\."]).catch(
		(error: unknown) => {
			if (gitExit(error) === 1) return "";
			throw error;
		},
	);
	const bases = new Set(
		names
			.split("\0")
			.filter(Boolean)
			.map((key) => key.slice(0, key.lastIndexOf("."))),
	);
	return [...bases].flatMap((name) => [
		"-c",
		`${name}.clean=`,
		"-c",
		`${name}.smudge=`,
		"-c",
		`${name}.process=`,
		"-c",
		`${name}.required=false`,
	]);
}

export async function readGitWorktreeStatus(cwd: string, source: string, baseCommit: string) {
	const overrides = await filterOverrides(cwd);
	const [status, head, branch, index] = await Promise.all([
		git(cwd, [
			...overrides,
			"status",
			"--porcelain=v1",
			"-z",
			"--no-renames",
			"--untracked-files=all",
			"--ignored=matching",
			"--ignore-submodules=none",
		]),
		git(cwd, ["rev-parse", "--verify", "HEAD^{commit}"]),
		git(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => ""),
		git(cwd, ["ls-files", "-v", "-z"]),
	]);
	const resolvedHead = head.trim();
	if (!oidPattern.test(resolvedHead)) throw new ManagedWorktreeGitError("git-failed");
	const references =
		resolvedHead === baseCommit
			? "base"
			: await git(source, [
					"for-each-ref",
					"--count=1",
					`--contains=${resolvedHead}`,
					"--format=%(refname)",
					"refs/heads",
					"refs/remotes",
					"refs/tags",
				]);
	const changed = [
		...new Set([
			...status
				.split("\0")
				.filter(Boolean)
				.map((entry) => entry.slice(3)),
			// Git can omit paths marked assume-unchanged or skip-worktree from status.
			...index
				.split("\0")
				.filter((entry) => /^[a-zS] /.test(entry))
				.map((entry) => entry.slice(2)),
		]),
	];
	return { head: resolvedHead, branchName: branch.trim() || null, changed, hasUniqueCommits: !references.trim() };
}

export async function isRegisteredGitWorktree(source: string, target: string): Promise<boolean> {
	const entries = (await git(source, ["worktree", "list", "--porcelain", "-z"])).split("\0");
	if (!entries.some((entry) => entry.startsWith("worktree ") && relative(entry.slice(9), target) === "")) return false;
	if (!(await lstat(join(target, ".git")).catch(() => undefined))?.isFile()) return false;
	const commonDir = async (cwd: string) =>
		realpath((await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trimEnd());
	const [sourceCommon, targetCommon] = await Promise.all([commonDir(source), commonDir(target)]);
	return relative(sourceCommon, targetCommon) === "";
}

export async function removeGitWorktree(source: string, target: string): Promise<void> {
	const [sourceFilters, targetFilters] = await Promise.all([filterOverrides(source), filterOverrides(target)]);
	await git(source, [...sourceFilters, ...targetFilters, "worktree", "remove", "--", target]);
	await rmdir(dirname(target)).catch(() => undefined);
}
