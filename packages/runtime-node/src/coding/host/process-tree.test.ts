import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	formatWindowsStartTimeMs,
	type ProcessIdentity,
	trackNodeProcessTree,
	type WindowsProcessSignalRequest,
} from "./process-tree.js";

const tempRoots: string[] = [];
const trackedPids = new Set<number>();

function createTempFixture(source: (markerPath: string) => string): {
	readonly root: string;
	readonly script: string;
	readonly marker: string;
} {
	const root = mkdtempSync(join(tmpdir(), "567-process-tree-"));
	tempRoots.push(root);
	const marker = join(root, "pids.json");
	const script = join(root, "tree.cjs");
	writeFileSync(script, source(marker));
	return { root, script, marker };
}

async function waitForMarker<T extends Record<string, number | undefined>>(marker: string): Promise<T> {
	let parsed = {} as T;
	await vi.waitFor(
		() => {
			parsed = JSON.parse(readFileSync(marker, "utf8")) as T;
			for (const pid of Object.values(parsed)) {
				expect(typeof pid === "number" && pid > 0).toBe(true);
			}
		},
		{ timeout: 3_000, interval: 15 },
	);
	for (const pid of Object.values(parsed)) {
		if (typeof pid === "number" && pid > 0) trackedPids.add(pid);
	}
	return parsed;
}

function isPosixPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		if (process.platform === "linux") {
			return !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
		}
		return true;
	} catch {
		return false;
	}
}

class MockChildProcess extends EventEmitter {
	pid: number | undefined;
	exitCode: number | null = null;
	signalCode: NodeJS.Signals | null = null;
	readonly kill = vi.fn(() => true);

	constructor(pid?: number) {
		super();
		this.pid = pid;
	}

	markExited(code = 0): void {
		this.exitCode = code;
		this.emit("exit", code, null);
	}
}

afterEach(() => {
	for (const pid of trackedPids) if (isPosixPidAlive(pid)) process.kill(pid, "SIGKILL");
	trackedPids.clear();
	for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(process.platform === "win32")("POSIX real process tree termination", () => {
	it("terminates detached root, regular child, and actual detached grandchild after bounded grace", async () => {
		const fixture = createTempFixture((marker) =>
			[
				"const { spawn } = require('node:child_process');",
				"const { writeFileSync } = require('node:fs');",
				"process.on('SIGTERM', () => {});",
				"const regularChild = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { stdio: 'ignore' });",
				"const detachedChild = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { detached: true, stdio: 'ignore' });",
				`writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ root: process.pid, regularChild: regularChild.pid, detachedChild: detachedChild.pid }));`,
				"setInterval(() => {}, 1000);",
			].join("\n"),
		);
		const child = spawn(process.execPath, [fixture.script], { detached: true, stdio: "ignore" });
		const pids = await waitForMarker<{ root: number; regularChild: number; detachedChild: number }>(fixture.marker);
		const tracker = trackNodeProcessTree(child, { detached: true, forceAfterMs: 80, waitAfterForceMs: 250 });

		await tracker.terminate();

		expect(isPosixPidAlive(pids.root)).toBe(false);
		expect(isPosixPidAlive(pids.regularChild)).toBe(false);
		expect(isPosixPidAlive(pids.detachedChild)).toBe(false);
	});

	it("settles early when processes exit gracefully on SIGTERM", async () => {
		const fixture = createTempFixture((marker) =>
			[
				"const { writeFileSync } = require('node:fs');",
				`writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ root: process.pid }));`,
				"setInterval(() => {}, 1000);",
			].join("\n"),
		);
		const child = spawn(process.execPath, [fixture.script], { detached: true, stdio: "ignore" });
		const pids = await waitForMarker<{ root: number }>(fixture.marker);
		const tracker = trackNodeProcessTree(child, { detached: true, forceAfterMs: 3_000 });
		const startedAt = Date.now();

		await tracker.terminate();

		expect(isPosixPidAlive(pids.root)).toBe(false);
		expect(Date.now() - startedAt).toBeLessThan(1_500);
	});

	it("terminates surviving group descendants when detached root exits first", async () => {
		const fixture = createTempFixture((marker) =>
			[
				"const { spawn } = require('node:child_process');",
				"const { writeFileSync } = require('node:fs');",
				"const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: ['ignore', 1, 2] });",
				`writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ root: process.pid, child: child.pid }));`,
				"child.unref();",
				"process.exit(0);",
			].join("\n"),
		);
		const child = spawn(process.execPath, [fixture.script], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
		const tracker = trackNodeProcessTree(child, { detached: true, forceAfterMs: 100, waitAfterForceMs: 250 });
		const pids = await waitForMarker<{ root: number; child: number }>(fixture.marker);
		await vi.waitFor(() => expect(child.exitCode).toBe(0), { timeout: 2_000 });

		await tracker.terminate();
		child.stdout?.destroy();
		child.stderr?.destroy();

		expect(isPosixPidAlive(pids.child)).toBe(false);
	});

	it("kills non-detached root and its detached child without signaling negative root pid", async () => {
		const fixture = createTempFixture((marker) =>
			[
				"const { spawn } = require('node:child_process');",
				"const { writeFileSync } = require('node:fs');",
				"const detachedChild = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)\"], { detached: true, stdio: 'ignore' });",
				`writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ root: process.pid, detachedChild: detachedChild.pid }));`,
				"setInterval(() => {}, 1000);",
			].join("\n"),
		);
		const child = spawn(process.execPath, [fixture.script], { detached: false, stdio: "ignore" });
		const pids = await waitForMarker<{ root: number; detachedChild: number }>(fixture.marker);
		const sentSignals: Array<{ readonly pid: number; readonly signal: NodeJS.Signals }> = [];
		const tracker = trackNodeProcessTree(child, {
			detached: false,
			forceAfterMs: 80,
			waitAfterForceMs: 250,
			runtime: {
				sendSignal(pid, signal) {
					sentSignals.push({ pid, signal });
					process.kill(pid, signal);
				},
			},
		});

		await tracker.terminate();

		expect(sentSignals.some((entry) => entry.pid === -pids.root)).toBe(false);
		expect(isPosixPidAlive(pids.root)).toBe(false);
		expect(isPosixPidAlive(pids.detachedChild)).toBe(false);
	});

	it("escalates immediately when terminate({ force: true }) is called mid-grace", async () => {
		const fixture = createTempFixture((marker) =>
			[
				"const { writeFileSync } = require('node:fs');",
				"process.on('SIGTERM', () => {});",
				`writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ root: process.pid }));`,
				"setInterval(() => {}, 1000);",
			].join("\n"),
		);
		const child = spawn(process.execPath, [fixture.script], { detached: true, stdio: "ignore" });
		const pids = await waitForMarker<{ root: number }>(fixture.marker);
		const tracker = trackNodeProcessTree(child, { detached: true, forceAfterMs: 5_000, waitAfterForceMs: 250 });
		const startedAt = Date.now();

		const pending = tracker.terminate();
		setTimeout(() => {
			void tracker.terminate({ force: true });
		}, 40);
		await pending;

		expect(isPosixPidAlive(pids.root)).toBe(false);
		expect(Date.now() - startedAt).toBeLessThan(1_500);
	});
});

describe("mocked Windows process tree termination", () => {
	it("records root creation time, discovers descendants, and runs graceful then bounded force", async () => {
		const rootPid = 41_001;
		const childPid = 41_002;
		const rootStart = formatWindowsStartTimeMs(10_000);
		const childStart = formatWindowsStartTimeMs(10_100);
		let liveTree: ProcessIdentity[] = [
			{ pid: rootPid, parentPid: 1, startTime: rootStart },
			{ pid: childPid, parentPid: rootPid, startTime: childStart },
		];
		const signalCalls: WindowsProcessSignalRequest[] = [];
		const child = new MockChildProcess(rootPid);

		const tracker = trackNodeProcessTree(child as unknown as ChildProcess, {
			forceAfterMs: 40,
			waitAfterForceMs: 40,
			runtime: {
				platform: "win32",
				captureWindowsRootStartTime: async () => rootStart,
				readProcessListAsync: async () => liveTree,
				signalWindowsProcesses: async (request) => {
					signalCalls.push(request);
					if (request.force) {
						liveTree = [];
						child.markExited(1);
					}
					return request.targets.map((target) => target.pid);
				},
			},
		});

		await tracker.terminate();

		expect(signalCalls).toHaveLength(2);
		expect(signalCalls[0]?.force).toBe(false);
		expect(signalCalls[0]?.targets.map((item) => item.pid)).toEqual([childPid, rootPid]);
		expect(signalCalls[1]?.force).toBe(true);
		expect(signalCalls[1]?.targets.map((item) => item.pid)).toEqual([childPid, rootPid]);
		expect(child.kill).not.toHaveBeenCalled();
	});

	it("refuses to signal when root creation time mismatches after PID reuse", async () => {
		const rootPid = 42_001;
		const recordedRootStart = formatWindowsStartTimeMs(10_000);
		const reusedRootStart = formatWindowsStartTimeMs(20_000);
		const unrelatedChildStart = formatWindowsStartTimeMs(20_050);
		let phase: "spawn" | "reused" = "spawn";
		const signalCalls: WindowsProcessSignalRequest[] = [];
		const child = new MockChildProcess(rootPid);

		const tracker = trackNodeProcessTree(child as unknown as ChildProcess, {
			forceAfterMs: 30,
			waitAfterForceMs: 20,
			runtime: {
				platform: "win32",
				captureWindowsRootStartTime: async () => recordedRootStart,
				readProcessListAsync: async () =>
					phase === "spawn"
						? [{ pid: rootPid, parentPid: 1, startTime: recordedRootStart }]
						: [
								{ pid: rootPid, parentPid: 1, startTime: reusedRootStart },
								{ pid: 42_002, parentPid: rootPid, startTime: unrelatedChildStart },
							],
				signalWindowsProcesses: async (request) => {
					signalCalls.push(request);
					return [];
				},
			},
		});

		await Promise.resolve();
		phase = "reused";
		await tracker.terminate();

		expect(signalCalls).toEqual([]);
		expect(child.kill).not.toHaveBeenCalled();
	});

	it("revalidates descendant creation times before escalating and keeps the surviving owned descendant", async () => {
		const rootPid = 45_001;
		const recycledChildPid = 45_002;
		const ownedChildPid = 45_003;
		const identity = (pid: number, parentPid: number, createdAt: number): ProcessIdentity => ({
			pid,
			parentPid,
			startTime: formatWindowsStartTimeMs(createdAt),
		});
		const root = identity(rootPid, 1, 1_000);
		const owned = identity(ownedChildPid, rootPid, 1_100);
		let list = [root, identity(recycledChildPid, rootPid, 1_050), owned];
		const child = new MockChildProcess(rootPid);
		const signal = vi.fn(async (request: WindowsProcessSignalRequest) => {
			if (!request.force) {
				list = [root, identity(recycledChildPid, 1, 1_500), owned];
			} else {
				list = [identity(recycledChildPid, 1, 1_500)];
				child.markExited();
			}
			return request.targets.map((target) => target.pid);
		});
		await trackNodeProcessTree(child as unknown as ChildProcess, {
			forceAfterMs: 30,
			runtime: {
				platform: "win32",
				captureWindowsRootStartTime: async () => root.startTime,
				readProcessListAsync: async () => list,
				signalWindowsProcesses: signal,
			},
		}).terminate();

		expect(signal.mock.calls.find(([request]) => request.force)?.[0].targets).toEqual([owned, root]);
	});

	it("skips unqueryable descendants and falls back to ChildProcess.kill when CIM is unavailable", async () => {
		const child = new MockChildProcess(43_001);
		child.kill.mockImplementation(() => {
			child.markExited(1);
			return true;
		});
		const signalCalls: WindowsProcessSignalRequest[] = [];

		const tracker = trackNodeProcessTree(child as unknown as ChildProcess, {
			forceAfterMs: 30,
			waitAfterForceMs: 20,
			runtime: {
				platform: "win32",
				captureWindowsRootStartTime: async () => undefined,
				readProcessListAsync: async () => undefined,
				signalWindowsProcesses: async (request) => {
					signalCalls.push(request);
					return [];
				},
			},
		});

		await tracker.terminate();

		expect(signalCalls).toEqual([]);
		expect(child.kill).toHaveBeenCalledOnce();
	});

	it("kills surviving descendants bounded by [startedAtMs, exitedAtMs] when root already exited", async () => {
		let nowMs = 1_000;
		const rootPid = 44_001;
		const ownedChildPid = 44_002;
		const unrelatedLaterPid = 44_003;
		let liveTree: ProcessIdentity[] = [
			{ pid: ownedChildPid, parentPid: rootPid, startTime: formatWindowsStartTimeMs(1_200) },
			{ pid: unrelatedLaterPid, parentPid: rootPid, startTime: formatWindowsStartTimeMs(2_500) },
		];
		const signalCalls: WindowsProcessSignalRequest[] = [];
		const child = new MockChildProcess(rootPid);

		const tracker = trackNodeProcessTree(child as unknown as ChildProcess, {
			forceAfterMs: 30,
			waitAfterForceMs: 30,
			runtime: {
				platform: "win32",
				now: () => nowMs,
				captureWindowsRootStartTime: async () => formatWindowsStartTimeMs(1_000),
				readProcessListAsync: async () => liveTree,
				signalWindowsProcesses: async (request) => {
					signalCalls.push(request);
					if (request.force) {
						const killed = new Set(request.targets.map((target) => target.pid));
						liveTree = liveTree.filter((item) => !killed.has(item.pid));
					}
					return request.targets.map((target) => target.pid);
				},
			},
		});

		await new Promise<void>((resolve) => setImmediate(resolve));
		nowMs = 2_000;
		child.markExited(0);
		// Spurious duplicate exit at a later timestamp must not extend the ownership window.
		nowMs = 3_000;
		child.emit("exit", 0, null);
		// Late spawn event after exit must be ignored.
		child.emit("spawn");

		await tracker.terminate();

		expect(signalCalls.length).toBeGreaterThanOrEqual(2);
		for (const call of signalCalls) {
			expect(call.targets.map((item) => item.pid)).toEqual([ownedChildPid]);
		}
		expect(liveTree.map((item) => item.pid)).toEqual([unrelatedLaterPid]);
		expect(child.kill).not.toHaveBeenCalled();
	});
});
