import { type ChildProcess, execFile } from "node:child_process";
import { join } from "node:path";
import {
	CommandResourceLimitError,
	type CommandResourcePolicy,
	describeResourceBytes,
	readAvailableCommandMemory,
} from "./command-resource-policy.js";

interface ProcessMemory {
	readonly pid: number;
	readonly parent: number;
	readonly group: number;
	readonly bytes: number;
}

interface WatchedCommand {
	readonly child: ChildProcess;
	readonly policy: CommandResourcePolicy;
	readonly grouped: boolean;
	readonly onLimit: (error: CommandResourceLimitError) => void;
}

const commands = new Set<WatchedCommand>();
let timer: ReturnType<typeof setTimeout> | undefined;
let sampling = false;
let unavailableReported = false;

/** One bounded, non-overlapping sampler for all command trees in this host process. */
export function watchCommandMemory(
	child: ChildProcess,
	policy: CommandResourcePolicy,
	grouped: boolean,
	onLimit: WatchedCommand["onLimit"],
): () => void {
	const entry = { child, policy, grouped, onLimit };
	commands.add(entry);
	schedule();
	return () => {
		commands.delete(entry);
		if (commands.size === 0 && timer) {
			clearTimeout(timer);
			timer = undefined;
		}
	};
}

function schedule(): void {
	if (timer || sampling || commands.size === 0) return;
	timer = setTimeout(
		() => {
			timer = undefined;
			void sample();
		},
		process.platform === "win32" ? 1_000 : 500,
	);
	timer.unref();
}

async function sample(): Promise<void> {
	sampling = true;
	try {
		const processes = await readProcessMemory();
		unavailableReported = false;
		const owners = [...commands].filter(({ child }) => child.pid);
		const usage = owners.map((entry) => ({ entry, tree: collectTree(processes, entry) }));
		const all = new Map<number, ProcessMemory>();
		let totalLimit = Infinity;
		let largest: { entry: WatchedCommand; bytes: number } | undefined;
		for (const { entry, tree } of usage) {
			if (!commands.has(entry)) continue;
			const bytes = tree.reduce((sum, process) => sum + process.bytes, 0);
			if (bytes > entry.policy.memoryBytes) {
				entry.onLimit(
					new CommandResourceLimitError(
						`Command process tree used ${describeResourceBytes(bytes)}; limit ${describeResourceBytes(entry.policy.memoryBytes)}.`,
					),
				);
				continue;
			}
			for (const process of tree) all.set(process.pid, process);
			totalLimit = Math.min(totalLimit, entry.policy.totalMemoryBytes);
			if (!largest || bytes > largest.bytes) largest = { entry, bytes };
		}
		const totalBytes = [...all.values()].reduce((sum, process) => sum + process.bytes, 0);
		if (largest && commands.has(largest.entry) && totalBytes > totalLimit) {
			largest.entry.onLimit(
				new CommandResourceLimitError(
					`Concurrent commands used ${describeResourceBytes(totalBytes)}; combined limit ${describeResourceBytes(totalLimit)}. The largest command was stopped.`,
				),
			);
		} else if (
			largest &&
			commands.has(largest.entry) &&
			largest.bytes > 64 * 1024 * 1024 &&
			readAvailableCommandMemory() < largest.entry.policy.reserveBytes
		) {
			largest.entry.onLimit(
				new CommandResourceLimitError(
					"System memory headroom is low; the largest command was stopped to preserve memory for the app and other programs.",
				),
			);
		}
	} catch (error) {
		if (!unavailableReported) {
			unavailableReported = true;
			console.warn(
				"[command-resource-protection] Memory sampling unavailable; allocation limits remain active on Linux.",
				error instanceof Error ? error.message : String(error),
			);
		}
	} finally {
		sampling = false;
		schedule();
	}
}

function collectTree(processes: readonly ProcessMemory[], entry: WatchedCommand): ProcessMemory[] {
	const root = entry.child.pid;
	if (!root) return [];
	const members = new Set([root]);
	if (entry.grouped) for (const process of processes) if (process.group === root) members.add(process.pid);
	let changed = true;
	while (changed) {
		changed = false;
		for (const process of processes) {
			if (!members.has(process.pid) && members.has(process.parent)) {
				members.add(process.pid);
				changed = true;
			}
		}
	}
	return processes.filter((process) => members.has(process.pid));
}

function readProcessMemory(): Promise<ProcessMemory[]> {
	const windows = process.platform === "win32";
	const executable = windows
		? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
		: "/bin/ps";
	const args = windows
		? [
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize,PrivatePageCount | ConvertTo-Json -Compress",
			]
		: ["-axo", "pid=,ppid=,pgid=,rss="];
	return new Promise((resolve, reject) => {
		execFile(
			executable,
			args,
			{ encoding: "utf8", timeout: 5_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true },
			(error, stdout) => {
				if (error) return reject(error);
				try {
					resolve(windows ? parseWindowsMemory(stdout) : parsePosixMemory(stdout));
				} catch (error) {
					reject(error);
				}
			},
		);
	});
}

function parsePosixMemory(output: string): ProcessMemory[] {
	return output
		.trim()
		.split(/\r?\n/)
		.flatMap((line) => {
			const values = line.trim().split(/\s+/).map(Number);
			if (values.length !== 4 || values.some((value) => !Number.isSafeInteger(value) || value < 0)) return [];
			const [pid, parent, group, rss] = values as [number, number, number, number];
			return [{ pid, parent, group, bytes: rss * 1024 }];
		});
}

function parseWindowsMemory(output: string): ProcessMemory[] {
	const parsed: unknown = JSON.parse(output.replace(/^\uFEFF/, ""));
	return (Array.isArray(parsed) ? parsed : [parsed]).flatMap((value: unknown) => {
		if (!value || typeof value !== "object") return [];
		const record = value as Record<string, unknown>;
		const pid = Number(record.ProcessId);
		const parent = Number(record.ParentProcessId);
		const bytes = Math.max(Number(record.WorkingSetSize), Number(record.PrivatePageCount));
		if (![pid, parent, bytes].every((value) => Number.isSafeInteger(value) && value >= 0)) return [];
		return [{ pid, parent, group: 0, bytes }];
	});
}
