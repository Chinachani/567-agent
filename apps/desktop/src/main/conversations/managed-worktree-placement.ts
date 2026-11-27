import { realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { codingAgentSessionShardPath } from "@567agent/coding-agent/bootstrap";
import { readDesktopConfig } from "../config/desktop-config-store.js";
import { isRegisteredGitWorktree } from "../project-collaboration/worktree-git.js";
import {
	isPathInsideWorktree,
	parseManagedWorktreePath,
	resolveManagedWorktreeRoot,
} from "../project-collaboration/worktree-layout.js";
import { samePath } from "./session-paths.js";

const operations = new Map<string, number>();
const removing = new Set<string>();

function overlaps(left: string, right: string): boolean {
	return isPathInsideWorktree(left, right) || isPathInsideWorktree(right, left);
}

export function acquireManagedWorktreeRemoval(root: string): (() => void) | undefined {
	if ([...removing, ...operations.keys()].some((path) => overlaps(root, path))) return undefined;
	removing.add(root);
	return () => removing.delete(root);
}

export async function runManagedWorktreeOperation<T>(cwd: string, action: () => Promise<T>): Promise<T> {
	if ([...removing].some((root) => overlaps(root, cwd))) throw new Error("The isolated workspace is being removed");
	operations.set(cwd, (operations.get(cwd) ?? 0) + 1);
	try {
		return await action();
	} finally {
		const remaining = (operations.get(cwd) ?? 1) - 1;
		if (remaining) operations.set(cwd, remaining);
		else operations.delete(cwd);
	}
}

export async function resolveManagedWorktreePlacement(
	cwd: string | undefined,
	sessionPath?: string,
	projectHint?: string,
) {
	if (!cwd || !isAbsolute(cwd)) return undefined;
	const managedRoot = resolveManagedWorktreeRoot(getAgent567HomePath());
	const canonicalRoot = await realpath(managedRoot).catch(() => managedRoot);
	const path = parseManagedWorktreePath(managedRoot, cwd) ?? parseManagedWorktreePath(canonicalRoot, cwd);
	if (!path) {
		if (projectHint) throw new Error("The isolated workspace is outside the managed directory");
		return undefined;
	}
	const config = await readDesktopConfig();
	const project = [...config.projects, ...config.archivedProjects].find(({ path }) =>
		projectHint
			? samePath(path, projectHint)
			: sessionPath && samePath(dirname(sessionPath), codingAgentSessionShardPath(path)),
	);
	if (!project) throw new Error("The isolated workspace is no longer linked to a project");
	return { projectCwd: project.path, root: path.worktreeRoot, sessionDir: codingAgentSessionShardPath(project.path) };
}

export async function assertManagedWorktreeAvailable(cwd: string, root: string, projectCwd: string): Promise<void> {
	const [canonicalRoot, canonicalCwd] = await Promise.all([realpath(root), realpath(cwd)]).catch(() => [
		undefined,
		undefined,
	]);
	if (
		!canonicalRoot ||
		!canonicalCwd ||
		!samePath(canonicalRoot, root) ||
		!isPathInsideWorktree(canonicalRoot, canonicalCwd) ||
		!(await isRegisteredGitWorktree(projectCwd, canonicalRoot).catch(() => false))
	) {
		throw new Error("The isolated workspace is no longer available");
	}
}
