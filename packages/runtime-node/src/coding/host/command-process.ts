import type { CommandProcessPort, DesktopCommandResult } from "@567agent/runtime-tools";
import { spawnGuardedCommand } from "./guarded-command-process.js";

const DEFAULT_MAX_BUFFER_BYTES = 32 * 1024 * 1024;

export class NodeCommandProcessAbortedError extends Error {
	constructor() {
		super("Operation aborted");
		this.name = "NodeCommandProcessAbortedError";
	}
}

/** Creates a cancellable Node child-process implementation of CommandProcessPort. */
export function createNodeCommandProcessHost(): CommandProcessPort {
	return { run: (executable, args, options) => runCommandProcess(executable, args, options) };
}

function runCommandProcess(
	executable: string,
	args: readonly string[],
	options: Parameters<CommandProcessPort["run"]>[2],
): Promise<DesktopCommandResult> {
	return new Promise((resolve, reject) => {
		if (options.signal?.aborted) {
			reject(new NodeCommandProcessAbortedError());
			return;
		}
		const child = spawnGuardedCommand(executable, [...args], {
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
			env: process.env,
		});
		const maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
		let stdout = "";
		let stderr = "";
		let stopping = false;
		let timeoutHandle: NodeJS.Timeout | undefined;

		const cleanup = (): void => {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			options.signal?.removeEventListener("abort", onAbort);
		};
		const stop = (error: Error, force = false): void => {
			if (stopping) return;
			stopping = true;
			cleanup();
			const cleanupPromise = child.stopTree({ force });
			if (process.platform === "win32") {
				child.stdout?.destroy();
				child.stderr?.destroy();
				reject(error);
				void cleanupPromise.catch(() => undefined);
				return;
			}
			void cleanupPromise
				.catch(() => undefined)
				.finally(() => {
					child.stdout?.destroy();
					child.stderr?.destroy();
					reject(error);
				});
		};
		const onAbort = (): void => stop(new NodeCommandProcessAbortedError());
		const append = (data: Buffer, target: "stdout" | "stderr"): void => {
			if (stopping) return;
			const currentLength = target === "stdout" ? stdout.length : stderr.length;
			if (currentLength + data.length > maxBufferBytes) {
				stop(new Error(`Process output exceeded ${maxBufferBytes} bytes`), true);
				return;
			}
			if (target === "stdout") stdout += data.toString("utf8");
			else stderr += data.toString("utf8");
		};

		options.signal?.addEventListener("abort", onAbort, { once: true });
		if (options.timeoutMs > 0) {
			timeoutHandle = setTimeout(
				() => stop(new Error(`Process timed out after ${options.timeoutMs}ms`)),
				options.timeoutMs,
			);
		}
		child.stdout?.on("data", (data: Buffer) => append(data, "stdout"));
		child.stderr?.on("data", (data: Buffer) => append(data, "stderr"));
		child.on("error", (error) => {
			if (stopping) return;
			cleanup();
			reject(error);
		});
		child.on("close", (code) => {
			if (stopping) return;
			cleanup();
			resolve({ stdout, stderr, code });
		});
	});
}
