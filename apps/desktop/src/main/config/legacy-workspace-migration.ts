import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";

const DEFAULT_CONFIG_DIR_NAME = ".567agent";

export interface WorkspaceConfigShape {
	projects?: unknown;
	archivedProjects?: unknown;
	workspacePath?: unknown;
}

export interface LegacyWorkspacePaths {
	readonly configHome: string;
	readonly userHome: string;
	readonly legacyWorkspace: string;
	readonly canonicalWorkspace: string;
}

/**
 * Move only the old default workspace. A non-empty destination wins; in that case
 * the user's configured source path stays active and nothing is merged or removed.
 */
export function migrateLegacyWorkspace(
	config: WorkspaceConfigShape,
	paths: LegacyWorkspacePaths = defaultPaths(),
): WorkspaceConfigShape {
	if (resolve(paths.configHome) !== resolve(join(paths.userHome, DEFAULT_CONFIG_DIR_NAME))) {
		return withExpandedPath(config, paths.userHome);
	}

	const configuredPath = expandTilde(
		typeof config.workspacePath === "string" ? config.workspacePath : paths.canonicalWorkspace,
		paths.userHome,
	);
	if (resolve(configuredPath) !== resolve(paths.legacyWorkspace)) {
		return { ...config, workspacePath: configuredPath };
	}

	const sourceExists = existsSync(paths.legacyWorkspace);
	const destinationExists = existsSync(paths.canonicalWorkspace);
	if (sourceExists && destinationExists) {
		try {
			if (readdirSync(paths.canonicalWorkspace).length > 0) return { ...config, workspacePath: configuredPath };
			rmdirSync(paths.canonicalWorkspace);
		} catch {
			return { ...config, workspacePath: configuredPath };
		}
	}

	if (sourceExists) {
		try {
			mkdirSync(dirname(paths.canonicalWorkspace), { recursive: true });
			renameSync(paths.legacyWorkspace, paths.canonicalWorkspace);
		} catch {
			return { ...config, workspacePath: configuredPath };
		}
	}
	if (!existsSync(paths.canonicalWorkspace)) return { ...config, workspacePath: configuredPath };

	const rewritePath = (value: string): string => {
		const absolute = resolve(expandTilde(value, paths.userHome));
		const child = relative(resolve(paths.legacyWorkspace), absolute);
		if (child === ".." || child.startsWith(`..${sep}`) || absolute === resolve(paths.legacyWorkspace)) return value;
		return join(paths.canonicalWorkspace, child);
	};
	const rewriteEntries = (value: unknown): unknown => {
		if (!Array.isArray(value)) return value;
		return value.map((entry: unknown) => {
			if (typeof entry === "string") return rewritePath(entry);
			if (typeof entry !== "object" || entry === null || !("path" in entry)) return entry;
			const record = entry as { path?: unknown };
			return typeof record.path === "string" ? { ...record, path: rewritePath(record.path) } : entry;
		});
	};

	return {
		...config,
		projects: rewriteEntries(config.projects),
		archivedProjects: rewriteEntries(config.archivedProjects),
		workspacePath: paths.canonicalWorkspace,
	};
}

function withExpandedPath(config: WorkspaceConfigShape, userHome: string): WorkspaceConfigShape {
	return typeof config.workspacePath === "string"
		? { ...config, workspacePath: expandTilde(config.workspacePath, userHome) }
		: config;
}

function expandTilde(value: string, userHome: string): string {
	return value === "~" || value.startsWith("~/") ? join(userHome, value.slice(1)) : value;
}

function defaultPaths(): LegacyWorkspacePaths {
	const userHome = homedir();
	const configHome = process.env.VETTA_HOME || join(userHome, process.env.VETTA_CONFIG_DIR || DEFAULT_CONFIG_DIR_NAME);
	return {
		configHome,
		userHome,
		legacyWorkspace: join(userHome, ".vetta", "workspace"),
		canonicalWorkspace: join(configHome, "workspace"),
	};
}
