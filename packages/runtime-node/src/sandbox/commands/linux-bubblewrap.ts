import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join, resolve as resolvePath } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import type { SandboxShellGrant } from "@567agent/runtime-core/sandbox";
import type { ForegroundCommandOperations } from "@567agent/runtime-tools";
import { getSandboxShellGrant } from "../sandbox-permissions.js";
import type { NodeSandboxEnvironment, NodeSandboxShell } from "./contracts.js";

const LINUX_ENV_WHITELIST = [
	"PATH",
	"LANG",
	"LC_ALL",
	"TERM",
	"npm_config_registry",
	"npm_config_prefix",
	"npm_config_cache",
	"npm_config_userconfig",
	"NPM_CONFIG_REGISTRY",
	"NPM_CONFIG_PREFIX",
	"NPM_CONFIG_CACHE",
	"NPM_CONFIG_USERCONFIG",
	"PIP_INDEX_URL",
	"PIP_TRUSTED_HOST",
	"PIP_CONFIG_FILE",
	"PIP_CACHE_DIR",
	"AGENT567_HOME",
	"AGENT567_ACTION_RPC_ENDPOINT_FILE",
	"AGENT567_DESKTOP_EXE",
	"AGENT567_CLI_APP_PATH",
] as const;
const SANDBOX_HOME = "/tmp/567-agent-home";
const SANDBOX_BIN_DIR = "/567-agent-bin";
const STANDARD_READ_ONLY_ROOTS = ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"] as const;

export interface LinuxBubblewrapCommandOptions {
	readonly bubblewrapPath?: string;
	readonly resolveShell: () => NodeSandboxShell;
}

function killProcessGroup(pid: number): void {
	try {
		process.kill(-pid, "SIGKILL");
	} catch {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// Process already exited.
		}
	}
}

function findOnPathUnix(binary: string): string | undefined {
	try {
		const result = spawnSync("which", [binary], { encoding: "utf-8", timeout: 5000 });
		if (result.status !== 0 || !result.stdout) return undefined;
		const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
		return firstMatch && existsSync(firstMatch) ? firstMatch : undefined;
	} catch {
		return undefined;
	}
}

export function resolveLinuxBubblewrapPath(explicitPath?: string): string {
	const explicitCandidates = [explicitPath, process.env.AGENT567_LINUX_BWRAP_PATH].filter(
		(value): value is string => typeof value === "string" && value.trim().length > 0,
	);
	for (const candidate of explicitCandidates) {
		if (isAbsolute(candidate) && existsSync(candidate)) return candidate;
		const resolved = findOnPathUnix(candidate);
		if (resolved) return resolved;
	}
	const pathCandidates = ["bwrap", "bubblewrap"];
	for (const candidate of pathCandidates) {
		const resolved = findOnPathUnix(candidate);
		if (resolved) return resolved;
	}
	const searched = [...explicitCandidates, ...pathCandidates].map((item) => `  - ${item}`).join("\n");
	throw new Error(
		"Linux sandbox requires bubblewrap. Install `bwrap`/`bubblewrap` or set AGENT567_LINUX_BWRAP_PATH." +
			`\nSearched:\n${searched}`,
	);
}

function resolveLinuxShellCommand(resolveShell: () => NodeSandboxShell): NodeSandboxShell {
	const shell = resolveShell();
	const executable = isAbsolute(shell.executable) ? shell.executable : findOnPathUnix(shell.executable);
	if (!executable) throw new Error(`Linux sandbox shell not found on PATH: ${shell.executable}`);
	return { executable, args: shell.args };
}

function ensureShellIsWithinMountedRoots(shellPath: string): void {
	const normalizedShellPath = resolvePath(shellPath);
	const allowed = STANDARD_READ_ONLY_ROOTS.some((root) => {
		const normalizedRoot = resolvePath(root);
		return normalizedShellPath === normalizedRoot || normalizedShellPath.startsWith(`${normalizedRoot}/`);
	});
	if (!allowed) {
		throw new Error(
			`Linux sandbox cannot run shell outside standard system roots: ${normalizedShellPath}` +
				"\nConfigure shellPath to a binary under /usr, /bin, /sbin, /lib, /lib64, or /etc.",
		);
	}
}

function appendParentDirs(args: string[], targetPath: string, createdDirs: Set<string>): void {
	const segments = resolvePath(targetPath).split("/").filter(Boolean);
	let current = "";
	for (let index = 0; index < segments.length - 1; index++) {
		current += `/${segments[index]}`;
		if (createdDirs.has(current)) continue;
		args.push("--dir", current);
		createdDirs.add(current);
	}
}

function isUnderStandardReadOnlyRoot(path: string): boolean {
	const normalizedPath = resolvePath(path);
	return STANDARD_READ_ONLY_ROOTS.some((root) => {
		const normalizedRoot = resolvePath(root);
		return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
	});
}

function existingDir(path: string | undefined): string | undefined {
	if (!path?.trim()) return undefined;
	const normalized = resolvePath(path);
	return existsSync(normalized) && !isUnderStandardReadOnlyRoot(normalized) ? normalized : undefined;
}

function existingFile(path: string | undefined): string | undefined {
	if (!path?.trim()) return undefined;
	const normalized = resolvePath(path);
	return existsSync(normalized) && !isUnderStandardReadOnlyRoot(normalized) ? normalized : undefined;
}

function collectPathDirs(env: NodeSandboxEnvironment | undefined): string[] {
	const pathValue = env?.PATH ?? process.env.PATH;
	if (!pathValue) return [];
	return pathValue
		.split(delimiter)
		.map(existingDir)
		.filter((path): path is string => path !== undefined);
}

function collectEnvReadOnlyMounts(env: NodeSandboxEnvironment | undefined): {
	readonly dirs: string[];
	readonly files: string[];
} {
	const dirs = [
		existingDir(env?.npm_config_prefix ?? process.env.npm_config_prefix),
		existingDir(env?.NPM_CONFIG_PREFIX ?? process.env.NPM_CONFIG_PREFIX),
		existingDir(env?.npm_config_cache ?? process.env.npm_config_cache),
		existingDir(env?.NPM_CONFIG_CACHE ?? process.env.NPM_CONFIG_CACHE),
		existingDir(env?.PIP_CACHE_DIR ?? process.env.PIP_CACHE_DIR),
	].filter((path): path is string => path !== undefined);
	const agent567Home = env?.AGENT567_HOME ?? process.env.AGENT567_HOME;
	const endpointFile =
		env?.AGENT567_ACTION_RPC_ENDPOINT_FILE ??
		process.env.AGENT567_ACTION_RPC_ENDPOINT_FILE ??
		(agent567Home ? join(agent567Home, "action-server.json") : undefined);
	const files = [
		env?.npm_config_userconfig ?? process.env.npm_config_userconfig,
		env?.NPM_CONFIG_USERCONFIG ?? process.env.NPM_CONFIG_USERCONFIG,
		env?.PIP_CONFIG_FILE ?? process.env.PIP_CONFIG_FILE,
		endpointFile,
	]
		.map(existingFile)
		.filter((path): path is string => path !== undefined);
	return { dirs, files };
}

function readConfiguredAgent567Paths(env: NodeSandboxEnvironment | undefined): {
	readonly agent567AppPath?: string;
	readonly agent567CliAppPath?: string;
} {
	const configPath = join(env?.AGENT567_HOME ?? getAgent567HomePath(), "desktop-config.json");
	try {
		const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
			agent567AppPath?: unknown;
			agent567CliAppPath?: unknown;
			vettaAppPath?: unknown;
			vettaCliAppPath?: unknown;
		};
		return {
			agent567AppPath:
				typeof parsed.agent567AppPath === "string"
					? parsed.agent567AppPath
					: typeof parsed.vettaAppPath === "string"
						? parsed.vettaAppPath
						: undefined,
			agent567CliAppPath:
				typeof parsed.agent567CliAppPath === "string"
					? parsed.agent567CliAppPath
					: typeof parsed.vettaCliAppPath === "string"
						? parsed.vettaCliAppPath
						: undefined,
		};
	} catch {
		return {};
	}
}

function resolveAgent567DesktopExe(env: NodeSandboxEnvironment | undefined): string | undefined {
	return existingFile(
		env?.AGENT567_DESKTOP_EXE ?? process.env.AGENT567_DESKTOP_EXE ?? readConfiguredAgent567Paths(env).agent567AppPath,
	);
}

function resolveAgent567CliAppPath(env: NodeSandboxEnvironment | undefined): string | undefined {
	return existingFile(
		env?.AGENT567_CLI_APP_PATH ??
			process.env.AGENT567_CLI_APP_PATH ??
			readConfiguredAgent567Paths(env).agent567CliAppPath,
	);
}

function createAgent567CliShim(
	env: NodeSandboxEnvironment | undefined,
): { readonly hostDir: string; readonly hostPath: string } | undefined {
	const agent567CliAppPath = resolveAgent567CliAppPath(env);
	if (!agent567CliAppPath) return undefined;
	const hostDir = mkdtempSync(join(tmpdir(), "567-agent-linux-sandbox-bin-"));
	const hostPath = join(hostDir, "567-agent");
	writeFileSync(hostPath, ["#!/usr/bin/env sh", `exec "${agent567CliAppPath}" "$@"`, ""].join("\n"), "utf8");
	chmodSync(hostPath, 0o755);
	return { hostDir, hostPath };
}

export function buildLinuxSandboxArgs(
	command: string,
	cwd: string,
	shell: NodeSandboxShell,
	env: NodeSandboxEnvironment | undefined,
	grant: SandboxShellGrant | undefined,
	agent567CliShimPath: string | undefined,
): string[] {
	const args: string[] = ["--die-with-parent", "--new-session", "--unshare-pid", "--unshare-ipc", "--unshare-uts"];
	const createdDirs = new Set<string>();
	const mountedRoots = new Set<string>();
	appendParentDirs(args, cwd, createdDirs);
	for (const root of STANDARD_READ_ONLY_ROOTS) {
		if (!existsSync(root) || mountedRoots.has(root)) continue;
		args.push("--ro-bind", root, root);
		mountedRoots.add(root);
	}
	const readOnlyMounts = collectEnvReadOnlyMounts(env);
	const writableRoots = new Set((grant?.allowWriteRoots ?? []).map((root) => resolvePath(root)));
	const agent567DesktopExe = resolveAgent567DesktopExe(env);
	const agent567CliAppPath = resolveAgent567CliAppPath(env);
	const agent567DesktopExeDir = agent567DesktopExe ? resolvePath(agent567DesktopExe, "..") : undefined;
	const agent567CliAppDir = agent567CliAppPath ? resolvePath(agent567CliAppPath, "..") : undefined;
	for (const root of Array.from(new Set([...collectPathDirs(env), ...readOnlyMounts.dirs]))) {
		if (mountedRoots.has(root)) continue;
		if (writableRoots.has(root)) continue;
		appendParentDirs(args, root, createdDirs);
		args.push("--ro-bind", root, root);
		mountedRoots.add(root);
	}
	for (const file of Array.from(new Set(readOnlyMounts.files))) {
		if (mountedRoots.has(file)) continue;
		if (writableRoots.has(file)) continue;
		appendParentDirs(args, file, createdDirs);
		args.push("--ro-bind", file, file);
		mountedRoots.add(file);
	}
	args.push("--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp");
	appendParentDirs(args, cwd, new Set());
	args.push("--bind", cwd, cwd);
	for (const root of [agent567DesktopExeDir, agent567CliAppDir]) {
		if (!root || mountedRoots.has(root)) continue;
		appendParentDirs(args, root, createdDirs);
		args.push("--ro-bind", root, root);
		mountedRoots.add(root);
	}
	if (agent567CliShimPath)
		args.push("--dir", SANDBOX_BIN_DIR, "--ro-bind", agent567CliShimPath, `${SANDBOX_BIN_DIR}/567-agent`);
	for (const normalizedRoot of writableRoots) {
		if (!existsSync(normalizedRoot) || mountedRoots.has(normalizedRoot)) continue;
		appendParentDirs(args, normalizedRoot, createdDirs);
		args.push("--bind", normalizedRoot, normalizedRoot);
		mountedRoots.add(normalizedRoot);
	}
	args.push("--dir", SANDBOX_HOME);

	const baseEnv = env ?? process.env;
	const pathValue = agent567CliShimPath
		? [SANDBOX_BIN_DIR, baseEnv.PATH].filter((value): value is string => Boolean(value)).join(delimiter)
		: baseEnv.PATH;
	args.push("--clearenv");
	for (const key of LINUX_ENV_WHITELIST) {
		const value =
			key === "PATH"
				? pathValue
				: key === "AGENT567_DESKTOP_EXE"
					? agent567DesktopExe
					: key === "AGENT567_CLI_APP_PATH"
						? agent567CliAppPath
						: baseEnv[key];
		if (typeof value === "string" && value.length > 0) args.push("--setenv", key, value);
	}
	args.push("--setenv", "HOME", SANDBOX_HOME, "--setenv", "TMPDIR", "/tmp", "--setenv", "PWD", cwd);
	args.push("--chdir", cwd, "--", shell.executable, ...shell.args, command);
	return args;
}

export function createLinuxBubblewrapCommandOperations(
	options: LinuxBubblewrapCommandOptions,
): ForegroundCommandOperations {
	const bubblewrapPath = resolveLinuxBubblewrapPath(options.bubblewrapPath);
	const shell = resolveLinuxShellCommand(options.resolveShell);
	ensureShellIsWithinMountedRoots(shell.executable);
	return {
		exec: (command, cwd, { onData, signal, timeout, env }) =>
			new Promise<{ exitCode: number | null }>((resolve, reject) => {
				if (!existsSync(cwd)) return reject(new Error(`Working directory does not exist: ${cwd}`));
				const agent567CliShim = createAgent567CliShim(env);
				const args = buildLinuxSandboxArgs(
					command,
					cwd,
					shell,
					env,
					getSandboxShellGrant(cwd),
					agent567CliShim?.hostPath,
				);
				const child = spawn(bubblewrapPath, args, { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
				let timedOut = false;
				let timeoutHandle: NodeJS.Timeout | undefined;
				if (typeof timeout === "number" && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessGroup(child.pid);
					}, timeout * 1000);
				}
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				const onAbort = () => {
					if (child.pid) killProcessGroup(child.pid);
				};
				if (signal?.aborted) onAbort();
				else signal?.addEventListener("abort", onAbort, { once: true });
				const cleanup = () => {
					if (timeoutHandle) clearTimeout(timeoutHandle);
					signal?.removeEventListener("abort", onAbort);
					if (agent567CliShim) rmSync(agent567CliShim.hostDir, { recursive: true, force: true });
				};
				child.on("error", (error) => {
					cleanup();
					reject(error);
				});
				child.on("close", (code) => {
					cleanup();
					if (signal?.aborted) return reject(new Error("aborted"));
					if (timedOut) return reject(new Error(`timeout:${timeout}`));
					resolve({ exitCode: code });
				});
			}),
	};
}
