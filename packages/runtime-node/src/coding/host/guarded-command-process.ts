import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { watchCommandMemory } from "./command-memory-monitor.js";
import {
	CommandResourceLimitError,
	describeResourceBytes,
	readCommandResourcePolicy,
} from "./command-resource-policy.js";
import { killNodeProcessTree } from "./process-tree.js";

// Node 24 reserves a CodeRange counted by Linux RLIMIT_DATA even at low RSS.
// Keep an allocation ceiling of at least 1 GiB; the sampler still enforces the
// configured resident-tree budget. An inherited stricter hard limit is preserved.
// argv forwarding preserves the caller's original shell/command without interpolating its text.
const LINUX_ALLOCATION_GUARD = `guard_limit=$1
shift
guard_inherited=$(ulimit -H -d) || exit 125
if [ "$guard_inherited" != unlimited ] && [ "$guard_inherited" -lt "$guard_limit" ]; then guard_limit=$guard_inherited; fi
if ! ulimit -S -d "$guard_limit" || ! ulimit -H -d "$guard_limit"; then
    echo '[567 Agent resource protection] Cannot establish allocation limit; command was not started.' >&2
    exit 125
fi
exec "$@"`;

/** Shared command boundary for foreground, background, SDK and sandbox processes. */
export function spawnGuardedCommand(executable: string, args: readonly string[], options: SpawnOptions): ChildProcess {
	const policy = readCommandResourcePolicy();
	const grouped = process.platform !== "win32";
	const child =
		process.platform === "linux"
			? spawn(
					"/bin/sh",
					[
						"-c",
						LINUX_ALLOCATION_GUARD,
						"567-agent-memory-guard",
						String(Math.floor(Math.max(policy.memoryBytes, 1024 * 1024 * 1024) / 1024)),
						executable,
						...args,
					],
					{ ...options, detached: grouped },
				)
			: spawn(executable, [...args], { ...options, detached: grouped });
	let finished = false;
	let outputBytes = 0;
	let allocationFailure = false;
	let diagnosticTail = "";
	let stopWatching: (() => void) | undefined;
	const cleanup = (): void => {
		if (finished) return;
		finished = true;
		stopWatching?.();
	};
	const fail = (error: CommandResourceLimitError): void => {
		if (finished) return;
		cleanup();
		if (child.pid) killNodeProcessTree(child.pid);
		else child.kill();
		// Consumers already own error/cancel finalization. Resource failure must use that same path.
		child.emit("error", error);
	};
	const onOutput = (data: Buffer): void => {
		outputBytes += data.length;
		if (outputBytes > policy.outputBytes) {
			fail(
				new CommandResourceLimitError(
					`Command output exceeded ${describeResourceBytes(policy.outputBytes)}. Write large output to a file and inspect a bounded section.`,
				),
			);
		}
	};
	child.stdout?.on("data", onOutput);
	child.stderr?.on("data", (data: Buffer) => {
		onOutput(data);
		diagnosticTail = (diagnosticTail + data.toString("utf8")).slice(-1_024);
		if (
			/\b(?:MemoryError|ENOMEM|Cannot allocate memory|heap out of memory|Fatal process out of memory|CodeRange)\b/i.test(
				diagnosticTail,
			)
		)
			allocationFailure = true;
	});
	child.once("spawn", () => {
		if (!finished) stopWatching = watchCommandMemory(child, policy, grouped, fail);
	});
	child.once("error", cleanup);
	child.once("exit", (code) => {
		if (!finished && code !== 0 && allocationFailure) {
			cleanup();
			child.emit(
				"error",
				new CommandResourceLimitError(
					`Memory allocation failed while command protection was active (per-command budget ${describeResourceBytes(policy.memoryBytes)}).`,
				),
			);
		}
		// Root exit is not stream closure: descendants can still own these pipes.
	});
	child.once("close", cleanup);
	return child;
}
