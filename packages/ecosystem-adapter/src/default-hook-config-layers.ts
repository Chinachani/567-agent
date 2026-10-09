import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLAUDE_CODE_HOOK_PROFILE_ID } from "./claude-code/hooks/profile.js";
import { LATEST_CODEX_HOOK_PROFILE_ID } from "./codex/hooks/latest/profile.js";
import type { HookConfigLayer, HookConfigSource } from "./hooks/types.js";

/** Project / user config directory basename (brand default). */
export const AGENT567_HOOK_CONFIG_DIR_NAME = ".567agent";

export interface BuildDefaultHookConfigLayersOptions {
	/** Session project working directory. */
	cwd: string;
	/**
	 * Vetta user data root.
	 * Default: `~/.567agent` (HOME / USERPROFILE / os.homedir()).
	 * Coding Agent should pass `getAgent567HomePath()` so `AGENT567_HOME` applies.
	 */
	agent567Home?: string;
	/**
	 * Project config directory name under cwd. Default: `.567agent`.
	 * Override only for tests or non-standard layouts.
	 */
	configDirName?: string;
	/**
	 * Override home directory (tests). Default: HOME / USERPROFILE / os.homedir().
	 * Used only when `agent567Home` is omitted.
	 */
	homeDir?: string;
	/** Environment for HOME resolution. Default process.env. */
	env?: NodeJS.ProcessEnv;
}

/**
 * Build host config layers for ecosystem hook discovery under Vetta paths only.
 *
 * Mirrors official Codex/Claude directory layout **inside** Vetta roots:
 *
 * 1. User:
 *    - `<agent567Home>/.codex/hooks.json`
 *    - `<agent567Home>/.claude/settings.json`
 * 2. Project:
 *    - `<cwd>/.vetta/.codex/hooks.json`
 *    - `<cwd>/.vetta/.claude/settings.json`
 *    - `<cwd>/.vetta/.claude/settings.local.json`
 *
 * Does **not** read top-level official homes (`~/.codex`, `~/.claude`, project
 * `.codex` / `.claude` at cwd root). Hosts that need those must pass explicit layers.
 *
 * Each source carries `profileId` so Codex and Claude adapters never claim each other's files.
 * Missing files are ignored at discovery time (ENOENT).
 *
 * File formats match the original ecosystems (Codex `hooks.json`; Claude settings with `"hooks"`).
 */
export function buildDefaultHookConfigLayers(options: BuildDefaultHookConfigLayersOptions): HookConfigLayer[] {
	const env = options.env ?? process.env;
	const homeDir = options.homeDir ?? resolveHomeDir(env);
	const agent567Home = options.agent567Home ?? join(homeDir, AGENT567_HOOK_CONFIG_DIR_NAME);
	const configDirName = options.configDirName ?? AGENT567_HOOK_CONFIG_DIR_NAME;
	const projectVettaDir = join(options.cwd, configDirName);

	const legacyHome = options.agent567Home === undefined ? join(homeDir, ".vetta") : undefined;
	const legacyProject = options.configDirName === undefined ? join(options.cwd, ".vetta") : undefined;
	const userCodexDir = selectProfileDirectory(agent567Home, legacyHome, ".codex", ["hooks.json"]);
	const userClaudeDir = selectProfileDirectory(agent567Home, legacyHome, ".claude", ["settings.json"]);
	const projectCodexDir = selectProfileDirectory(projectVettaDir, legacyProject, ".codex", ["hooks.json"]);
	const projectClaudeDir = selectProfileDirectory(projectVettaDir, legacyProject, ".claude", [
		"settings.json",
		"settings.local.json",
	]);

	return [
		{
			directory: userCodexDir,
			enabled: true,
			label: "vetta-user-codex",
			sources: [codexSource(join(userCodexDir, "hooks.json"))],
		},
		{
			directory: userClaudeDir,
			enabled: true,
			label: "vetta-user-claude",
			sources: [claudeSource(join(userClaudeDir, "settings.json"))],
		},
		{
			directory: projectCodexDir,
			enabled: true,
			label: "vetta-project-codex",
			sources: [codexSource(join(projectCodexDir, "hooks.json"))],
		},
		{
			directory: projectClaudeDir,
			enabled: true,
			label: "vetta-project-claude",
			sources: [
				claudeSource(join(projectClaudeDir, "settings.json")),
				claudeSource(join(projectClaudeDir, "settings.local.json")),
			],
		},
	];
}

// A configured new profile replaces the legacy profile as a whole. Loading both
// would execute copied hooks twice, so fallback only when the new profile is absent.
function selectProfileDirectory(
	root: string,
	legacyRoot: string | undefined,
	profile: string,
	files: string[],
): string {
	const primary = join(root, profile);
	if (!legacyRoot || files.some((file) => existsSync(join(primary, file)))) return primary;
	const legacy = join(legacyRoot, profile);
	return files.some((file) => existsSync(join(legacy, file))) ? legacy : primary;
}

function codexSource(path: string): HookConfigSource {
	return { path, profileId: LATEST_CODEX_HOOK_PROFILE_ID };
}

function claudeSource(path: string): HookConfigSource {
	return { path, profileId: CLAUDE_CODE_HOOK_PROFILE_ID };
}

function resolveHomeDir(env: NodeJS.ProcessEnv): string {
	const fromEnv = env.HOME || env.USERPROFILE;
	if (fromEnv && fromEnv.length > 0) return fromEnv;
	return homedir();
}
