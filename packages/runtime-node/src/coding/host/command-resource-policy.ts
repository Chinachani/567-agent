import { readFileSync } from "node:fs";
import { freemem, totalmem } from "node:os";

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export interface CommandResourcePolicy {
	readonly memoryBytes: number;
	readonly totalMemoryBytes: number;
	readonly outputBytes: number;
	readonly reserveBytes: number;
}

export class CommandResourceLimitError extends Error {
	readonly code = "COMMAND_RESOURCE_LIMIT";

	constructor(message: string) {
		super(
			`[567 Agent resource protection] ${message} Reduce the image dimensions, tile radius, batch size or concurrency before retrying. Do not repeat the same allocation or disable protection.`,
		);
		this.name = "CommandResourceLimitError";
	}
}

/** Host configuration only: a command's env cannot raise its own limits. */
export function readCommandResourcePolicy(): CommandResourcePolicy {
	const constrained = process.constrainedMemory?.() ?? 0;
	const machineBytes = constrained > 0 ? Math.min(totalmem(), constrained) : totalmem();
	const maximum = Math.max(64 * MIB, Math.floor(machineBytes * 0.75));
	const memoryBytes = readBudget("AGENT567_COMMAND_MEMORY_MB", Math.min(8 * GIB, machineBytes / 4), maximum);
	const totalMemoryBytes = readBudget(
		"AGENT567_COMMAND_TOTAL_MEMORY_MB",
		Math.min(32 * GIB, machineBytes / 2),
		maximum,
	);
	const available = readAvailableCommandMemory();
	if (available < 64 * MIB) {
		throw new CommandResourceLimitError(
			"System memory headroom is below 64 MiB; this command was not started. Close memory-intensive tasks before retrying.",
		);
	}
	return {
		memoryBytes: Math.min(memoryBytes, totalMemoryBytes, Math.floor(available / 2)),
		totalMemoryBytes,
		outputBytes: readBudget("AGENT567_COMMAND_OUTPUT_MB", 32 * MIB, 256 * MIB),
		reserveBytes: Math.min(2 * GIB, machineBytes / 10),
	};
}

export function readAvailableCommandMemory(): number {
	// MemAvailable includes reclaimable cache; free RAM alone would stop ordinary Linux builds.
	if (process.platform === "linux") {
		try {
			const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(readFileSync("/proc/meminfo", "utf8"));
			if (available) {
				const bytes = Number(available[1]) * 1024;
				return (process.constrainedMemory?.() ?? 0) > 0
					? Math.min(bytes, process.availableMemory?.() ?? freemem())
					: bytes;
			}
		} catch {
			// Container/platform constraints remain available through Node.
		}
	}
	return process.availableMemory?.() ?? freemem();
}

function readBudget(name: string, fallbackBytes: number, maximumBytes: number): number {
	const configured = process.env[name];
	if (configured === undefined) return Math.max(MIB, Math.floor(Math.min(fallbackBytes, maximumBytes)));
	if (!/^\d+$/.test(configured) || !Number.isSafeInteger(Number(configured)) || Number(configured) < 1) {
		throw new Error(`${name} must be a positive integer in MiB. Resource protection cannot be disabled.`);
	}
	return Math.floor(Math.min(Number(configured) * MIB, maximumBytes));
}

export function describeResourceBytes(bytes: number): string {
	return `${Math.ceil(bytes / MIB)} MiB`;
}
