import type { ChildProcess } from "node:child_process";
import { trackNodeProcessTree } from "@567agent/runtime-node/host";
import { isSshProjectUri } from "@567agent/ssh-transport";
import type { PluginCommandRunOptions, PluginCommandRunResult } from "../../preload/api-types/plugins.js";
import { getAppLogger } from "../logger.js";
import { getRuntimeManager } from "../runtimes/manager.js";
import { createPluginCommandEnvironment } from "./command-environment.js";
import { prepareCommandRuntime, spawnCrossPlatformCommand } from "./command-launcher.js";
import { assertPluginCommandAllowed } from "./command-permissions.js";
import { runRemotePluginCommand } from "./remote-command-runner.js";

const commandLog = getAppLogger("plugin");

const activeRuns = new Map<symbol, { pluginId: string; stop: () => void }>();

export function stopPluginCommandRuns(pluginId?: string): void {
	for (const run of activeRuns.values()) if (pluginId === undefined || run.pluginId === pluginId) run.stop();
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10MB stdout/stderr cap

function clampTimeout(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return DEFAULT_TIMEOUT_MS;
	return Math.min(Math.floor(value), MAX_TIMEOUT_MS);
}

function sanitizeArgs(args: unknown): string[] {
	if (args === undefined) return [];
	if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
		throw new Error("Command args must be an array of strings");
	}
	return args as string[];
}

function sanitizeEnv(env: unknown): Record<string, string> | undefined {
	if (env === undefined) return undefined;
	if (env === null || typeof env !== "object" || Array.isArray(env)) {
		throw new Error("Command env must be a string map");
	}
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(env as Record<string, unknown>)) {
		if (typeof value !== "string") throw new Error(`Command env value for ${key} must be a string`);
		out[key] = value;
	}
	return out;
}

/**
 * Run a plugin-declared command through the shared cross-platform launcher.
 * Authoritative gate (defense in depth behind the renderer's own check):
 * the plugin must hold `agent.command.run`, have declared `file`, and have it
 * currently enabled. Returns buffered stdout/stderr + exit code; a non-zero
 * exit resolves normally (the caller inspects exitCode). Start failures, timeout,
 * output overflow and lifecycle cancellation reject after stopping the owned tree.
 */
export async function runPluginCommand(
	pluginId: string,
	file: string,
	args: unknown,
	options: PluginCommandRunOptions | undefined,
): Promise<PluginCommandRunResult> {
	assertPluginCommandAllowed(pluginId, file, "agent.command.run");

	const normalizedArgs = sanitizeArgs(args);
	const env = sanitizeEnv(options?.env);
	const cwd = typeof options?.cwd === "string" && options.cwd.trim().length > 0 ? options.cwd : undefined;
	const timeout = clampTimeout(options?.timeoutMs);
	if (!cwd || !isSshProjectUri(cwd)) await prepareCommandRuntime(file);
	assertPluginCommandAllowed(pluginId, file, "agent.command.run");

	if (cwd !== undefined && isSshProjectUri(cwd)) {
		const controller = new AbortController();
		const runId = Symbol(pluginId);
		activeRuns.set(runId, { pluginId, stop: () => controller.abort(new Error(`Command cancelled: ${file}`)) });
		try {
			return await runRemotePluginCommand({
				file,
				args: normalizedArgs,
				cwd,
				env,
				timeoutMs: timeout,
				maxBufferBytes: MAX_BUFFER_BYTES,
				signal: controller.signal,
			});
		} finally {
			activeRuns.delete(runId);
		}
	}

	// macOS 没装命令行工具时，/usr/bin/git 一执行就弹系统安装框；插件按「没装 git」处理即可。
	if (file === "git" && getRuntimeManager().shouldBlockGitCommand()) {
		throw new Error(`Command failed to start: ${file} (ENOENT)`);
	}

	let child: ChildProcess;
	const detached = process.platform !== "win32";
	try {
		child = spawnCrossPlatformCommand(file, normalizedArgs, {
			cwd,
			env: createPluginCommandEnvironment(env),
			windowsHide: true,
			detached,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		commandLog.warn("plugin command spawn failed", { pluginId, file, code });
		throw new Error(`Command failed to start: ${file} (${code ?? String(error)})`);
	}
	const tree = trackNodeProcessTree(child, { detached });

	return new Promise<PluginCommandRunResult>((resolvePromise, rejectPromise) => {
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		const runId = Symbol(pluginId);
		let settled = false;
		let stopping = false;

		const finish = (result: PluginCommandRunResult | Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			activeRuns.delete(runId);
			if (result instanceof Error) rejectPromise(result);
			else resolvePromise(result);
		};
		const stop = (reason: Error, force = false): void => {
			if (settled || stopping) return;
			stopping = true;
			void tree.terminate({ force }).finally(() => {
				child.stdout?.destroy();
				child.stderr?.destroy();
				finish(reason);
			});
		};
		const append = (chunks: Buffer[], chunk: Buffer, stream: "stdout" | "stderr"): void => {
			if (settled || stopping) return;
			if (stream === "stdout") stdoutBytes += chunk.length;
			else stderrBytes += chunk.length;
			if (stdoutBytes + stderrBytes > MAX_BUFFER_BYTES) {
				stop(new Error(`Command output exceeded ${MAX_BUFFER_BYTES} bytes: ${file}`), true);
				return;
			}
			chunks.push(chunk);
		};
		const timeoutHandle = setTimeout(() => stop(new Error(`Command timed out after ${timeout}ms: ${file}`)), timeout);
		timeoutHandle.unref();
		activeRuns.set(runId, { pluginId, stop: () => stop(new Error(`Command cancelled: ${file}`)) });

		child.stdout?.on("data", (chunk: Buffer) => append(stdout, chunk, "stdout"));
		child.stderr?.on("data", (chunk: Buffer) => append(stderr, chunk, "stderr"));
		child.once("error", (error: NodeJS.ErrnoException) => {
			commandLog.warn("plugin command spawn failed", { pluginId, file, code: error.code });
			stop(new Error(`Command failed to start: ${file} (${error.code ?? error.message})`));
		});
		child.once("close", (exitCode, signal) => {
			if (stopping) return;
			finish({
				stdout: Buffer.concat(stdout).toString(),
				stderr: Buffer.concat(stderr).toString(),
				exitCode: exitCode ?? (signal ? 1 : null),
			});
		});
	});
}
