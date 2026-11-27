import { readCommandResourcePolicy } from "../coding/host/command-resource-policy.js";
import { spawnGuardedCommand } from "../coding/host/guarded-command-process.js";

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
					options?.signal?.removeEventListener("abort", onAbort);
					resolve({ stdout, stderr, code, killed });
				};

				const stop = (force = false): void => {
					if (settled || killed) return;
					killed = true;
					void child.stopTree({ force }).finally(() => {
						child.stdout?.destroy();
						child.stderr?.destroy();
						finish(143);
					});
				};
				const onAbort = (): void => stop();
				const append = (data: Buffer, stream: "stdout" | "stderr"): void => {
					if (settled || killed) return;
					outputBytes += data.byteLength;
					if (outputBytes > outputLimit) {
						stderr += "\nCommand output limit exceeded\n";
						stop(true);
						return;
					}
					if (stream === "stdout") stdout += data.toString();
					else stderr += data.toString();
				};
				if (options?.signal?.aborted) stop();
				else options?.signal?.addEventListener("abort", onAbort, { once: true });
				if (!killed && options?.timeout && options.timeout > 0)
					timeoutHandle = setTimeout(onAbort, options.timeout);
				child.stdout?.on("data", (data: Buffer) => {
					append(data, "stdout");
				});
				child.stderr?.on("data", (data: Buffer) => {
					append(data, "stderr");
				});
				child.once("close", (code, signal) => {
					if (killed) return;
					killed ||= signal !== null;
					finish(code ?? 1);
				});
				child.once("error", (error) => {
					if (settled || killed) return;
					stderr += `\n${error.message}\n`;
					child.stdout?.destroy();
					child.stderr?.destroy();
					finish(1);
				});
			});
		},
	};
}
