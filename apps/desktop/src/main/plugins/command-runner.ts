import type { ChildProcess } from "node:child_process";
import { killNodeProcessTree } from "@567agent/runtime-node/host";
import type { PluginCommandRunOptions, PluginCommandRunResult } from "../../preload/api-types/plugins.js";
import { getAppLogger } from "../logger.js";
import { createPluginCommandEnvironment } from "./command-environment.js";
import { prepareCommandRuntime, spawnCrossPlatformCommand } from "./command-launcher.js";
import { assertPluginCommandAllowed } from "./command-permissions.js";

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
	await prepareCommandRuntime(file);
	assertPluginCommandAllowed(pluginId, file, "agent.command.run");

	let child: ChildProcess;
	try {
		child = spawnCrossPlatformCommand(file, normalizedArgs, {
			cwd,
			env: createPluginCommandEnvironment(env),
			windowsHide: true,
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		commandLog.warn("plugin command spawn failed", { pluginId, file, code });
		throw new Error(`Command failed to start: ${file} (${code ?? String(error)})`);
	}

	return new Promise<PluginCommandRunResult>((resolvePromise, rejectPromise) => {
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		const runId = Symbol(pluginId);
		let settled = false;

		const finish = (result: PluginCommandRunResult | Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutHandle);
			activeRuns.delete(runId);
			if (result instanceof Error) rejectPromise(result);
			else resolvePromise(result);
		};
		const stop = (reason: Error): void => {
			if (settled) return;
			if (child.pid) killNodeProcessTree(child.pid);
			else child.kill("SIGKILL");
			child.stdout?.destroy();
			child.stderr?.destroy();
			finish(reason);
		};
		const append = (chunks: Buffer[], chunk: Buffer, stream: "stdout" | "stderr"): void => {
			if (settled) return;
			if (stream === "stdout") stdoutBytes += chunk.length;
			else stderrBytes += chunk.length;
			if (stdoutBytes + stderrBytes > MAX_BUFFER_BYTES) {
				stop(new Error(`Command output exceeded ${MAX_BUFFER_BYTES} bytes: ${file}`));
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
			finish({
				stdout: Buffer.concat(stdout).toString(),
				stderr: Buffer.concat(stderr).toString(),
				exitCode: exitCode ?? (signal ? 1 : null),
			});
		});
	});
}
