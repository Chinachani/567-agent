import { isAbsolute, join, relative, resolve, sep } from "node:path";

const BUCKET_PATTERN = /^[0-9a-f]{4}$/;

export function resolveManagedWorktreeRoot(homeDir: string): string {
	return join(homeDir, "worktrees");
}

function normalizeComparisonPath(value: string): string {
	const normalized = resolve(value);
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isSameWorktreePath(left: string, right: string): boolean {
	return normalizeComparisonPath(left) === normalizeComparisonPath(right);
}

export function isPathInsideWorktree(parent: string, candidate: string): boolean {
	const rel = relative(normalizeComparisonPath(parent), normalizeComparisonPath(candidate));
	return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

/**
 * Parse `<managedRoot>/<bucket>/<name>[/<relativePath>]`.
 * Callers should realpath both arguments first to prevent symlink bypass.
 */
export function parseManagedWorktreePath(managedRoot: string, candidatePath: string) {
	if (!isPathInsideWorktree(managedRoot, candidatePath)) return null;
	const rel = relative(managedRoot, candidatePath);
	if (rel === "") return null;
	const segments = rel.split(sep).filter((segment) => segment.length > 0);
	const [bucket, name, ...rest] = segments;
	if (!bucket || !name || !BUCKET_PATTERN.test(bucket)) return null;
	return {
		worktreeRoot: join(resolve(managedRoot), bucket, name),
		relativePath: rest.join(sep),
	};
}
