import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve as resolvePath } from "node:path";
import { resolveExistingPath } from "../coding/shared/path-resolution.js";

export interface NodeWorkspacePathAccess {
	readonly allowed: boolean;
	readonly workspaceRoot: string;
	readonly targetPath: string;
	readonly targetBoundary: string;
}

function normalizeForComparison(value: string): string {
	const resolved = resolvePath(value);
	return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
	const normalizedTarget = normalizeForComparison(targetPath);
	const normalizedRoot = normalizeForComparison(rootPath);
	const rel = relative(normalizedRoot, normalizedTarget);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await stat(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function resolveBoundaryPath(targetPath: string): Promise<string> {
	const absolutePath = resolvePath(targetPath);
	if (await pathExists(absolutePath)) return realpath(absolutePath);

	let current = dirname(absolutePath);
	while (true) {
		if (await pathExists(current)) return realpath(current);
		const parent = dirname(current);
		if (parent === current) return absolutePath;
		current = parent;
	}
}

export async function resolveNodeWorkspacePathAccess(
	requestedPath: string,
	workspaceCwd: string,
): Promise<NodeWorkspacePathAccess> {
	const workspaceRoot = await resolveBoundaryPath(workspaceCwd);
	// Use the same Unicode/fuzzy correction as path-taking coding tools before
	// authorizing. The returned path is also passed to the tool for execution.
	const targetPath = resolveExistingPath(requestedPath, workspaceCwd);
	const targetBoundary = await resolveBoundaryPath(targetPath);
	return {
		allowed: isWithinRoot(targetBoundary, workspaceRoot),
		workspaceRoot,
		targetPath,
		targetBoundary,
	};
}
