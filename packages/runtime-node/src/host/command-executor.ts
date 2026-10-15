import { readCommandResourcePolicy } from "../coding/host/command-resource-policy.js";
import { spawnGuardedCommand } from "../coding/host/guarded-command-process.js";
import { killNodeProcessTree } from "../coding/host/process-tree.js";

export interface NodeCommandExecutionOptions {
	readonly signal?: AbortSignal;
	readonly timeout?: number;
}

export interface NodeCommandExecutionResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly code: number;
	readonly killed: boolean;
}

export interface NodeCommandExecutor {
	execute(
		command: string,
		args: readonly string[],
		cwd: string,
		options?: NodeCommandExecutionOptions,
	): Promise<NodeCommandExecutionResult>;
}

/** Executes an argv-based command without shell interpolation. */
export function createNodeCommandExecutor(): NodeCommandExecutor {
	return {
		execute(command, args, cwd, options) {
			return new Promise((resolve) => {
				const outputLimit = readCommandResourcePolicy().outputBytes;
				const child = spawnGuardedCommand(command, [...args], {
					cwd,
					shell: false,
					stdio: ["ignore", "pipe", "pipe"],
					windowsHide: true,
				});
				let outputBytes = 0;
				let stdout = "";
				let stderr = "";
				let killed = false;
				let settled = false;
				let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

				const finish = (code: number): void => {
					if (settled) return;
					settled = true;
					if (timeoutHandle) clearTimeout(timeoutHandle);
					options?.signal?.removeEventListener("abort", stop);
					resolve({ stdout, stderr, code, killed });
				};

				const stop = (): void => {
					if (settled) return;
					killed = true;
					if (child.pid) killNodeProcessTree(child.pid);
					else child.kill("SIGKILL");
					child.stdout?.destroy();
					child.stderr?.destroy();
					finish(143);
				};
				const append = (data: Buffer, stream: "stdout" | "stderr"): void => {
					if (settled) return;
					outputBytes += data.byteLength;
					if (outputBytes > outputLimit) {
						stderr += "\nCommand output limit exceeded\n";
						stop();
						return;
					}
					if (stream === "stdout") stdout += data.toString();
					else stderr += data.toString();
				};
				if (options?.signal?.aborted) stop();
				else options?.signal?.addEventListener("abort", stop, { once: true });
				if (!settled && options?.timeout && options.timeout > 0) timeoutHandle = setTimeout(stop, options.timeout);
				child.stdout?.on("data", (data: Buffer) => {
					append(data, "stdout");
				});
				child.stderr?.on("data", (data: Buffer) => {
					append(data, "stderr");
				});
				child.once("close", (code, signal) => {
					killed ||= signal !== null;
					finish(code ?? 1);
				});
				child.once("error", (error) => {
					if (settled) return;
					stderr += `\n${error.message}\n`;
					if (child.pid) killNodeProcessTree(child.pid);
					child.stdout?.destroy();
					child.stderr?.destroy();
					finish(1);
				});
			});
		},
	};
}
