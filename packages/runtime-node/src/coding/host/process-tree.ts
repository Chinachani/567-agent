import { type ChildProcess, execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_FORCE_AFTER_MS = 2_000;
const DEFAULT_WAIT_AFTER_FORCE_MS = 250;
const PROCESS_QUERY_TIMEOUT_MS = 1_500;
const POLL_INTERVAL_MS = 25;
const DOTNET_UNIX_EPOCH_TICKS = 621_355_968_000_000_000n;
const TICKS_PER_MICROSECOND = 10n;
const TICKS_PER_MILLISECOND = 10_000n;
// CIM exposes creation time to microsecond precision, while .NET exposes 100 ns ticks.
const WINDOWS_TICK_TOLERANCE = TICKS_PER_MICROSECOND - 1n;
const WINDOWS_START_TIME_PREFIX = "win-us:";

export interface ProcessIdentity {
	readonly pid: number;
	readonly parentPid: number;
	readonly processGroupId?: number;
	readonly startTime: string;
}

export interface WindowsProcessSignalRequest {
	readonly force: boolean;
	readonly targets: readonly ProcessIdentity[];
	readonly timeoutMs: number;
}

export interface ProcessTreeRuntime {
	readonly platform?: NodeJS.Platform;
	readonly now?: () => number;
	readonly isPidAlive?: (pid: number) => boolean;
	readonly sendSignal?: (pid: number, signal: NodeJS.Signals) => void;
	readonly readProcessList?: () => readonly ProcessIdentity[] | undefined;
	readonly readProcessListAsync?: () => Promise<readonly ProcessIdentity[] | undefined>;
	readonly captureWindowsRootStartTime?: (pid: number) => Promise<string | undefined>;
	readonly signalWindowsProcesses?: (request: WindowsProcessSignalRequest) => Promise<readonly number[]>;
}

export interface TrackNodeProcessTreeOptions {
	readonly detached?: boolean;
	readonly forceAfterMs?: number;
	readonly waitAfterForceMs?: number;
	readonly runtime?: ProcessTreeRuntime;
}

export interface TerminateNodeProcessTreeOptions {
	readonly force?: boolean;
}

export interface NodeProcessTreeTracker {
	terminate(options?: TerminateNodeProcessTreeOptions): Promise<void>;
}

export function formatWindowsStartTimeMs(timestampMs: number): string {
	return `${WINDOWS_START_TIME_PREFIX}${Math.trunc(timestampMs) * 1_000}`;
}

export function trackNodeProcessTree(
	child: ChildProcess,
	options: TrackNodeProcessTreeOptions = {},
): NodeProcessTreeTracker {
	const platform = options.runtime?.platform ?? process.platform;
	const now = () => options.runtime?.now?.() ?? Date.now();
	const startedAtMs = now();
	let exitedAtMs = hasChildExited(child) ? now() : undefined;
	let rootStartTime: string | undefined;
	let rootCapturePromise: Promise<void> | undefined;
	let activeGraceTimer: ReturnType<typeof setTimeout> | undefined;
	let wakeGraceWait: (() => void) | undefined;
	let forceRequested = false;
	let activeTermination: Promise<void> | undefined;

	const detach = (): void => {
		child.off?.("spawn", onSpawn);
		child.off?.("exit", onExit);
		child.off?.("error", onError);
	};

	const startRootCapture = (): void => {
		if (platform !== "win32" || rootCapturePromise || exitedAtMs !== undefined || hasChildExited(child)) return;
		const pid = child.pid;
		if (!isValidPid(pid)) return;
		rootCapturePromise = captureWindowsRootStartTime(pid, options)
			.then((captured) => {
				const createdAtMs = captured && parseWindowsCreationTimeMs(captured);
				if (
					captured &&
					typeof createdAtMs === "number" &&
					createdAtMs <= startedAtMs &&
					exitedAtMs === undefined &&
					!hasChildExited(child)
				) {
					rootStartTime = captured;
				}
			})
			.catch(() => undefined);
	};

	const onSpawn = (): void => {
		if (exitedAtMs !== undefined || hasChildExited(child)) return;
		startRootCapture();
	};

	const onExit = (): void => {
		if (exitedAtMs !== undefined) return;
		exitedAtMs = now();
		detach();
	};

	const onError = (): void => {
		if (!isValidPid(child.pid) && exitedAtMs === undefined) {
			exitedAtMs = now();
			detach();
		}
	};

	if (exitedAtMs === undefined && !hasChildExited(child)) {
		child.on?.("spawn", onSpawn);
		child.on?.("exit", onExit);
		child.on?.("error", onError);
		startRootCapture();
	}

	const runTerminate = async (initialForce: boolean): Promise<void> => {
		forceRequested ||= initialForce;
		const registerGraceWake = (wake: () => void, timer: ReturnType<typeof setTimeout>): void => {
			wakeGraceWait = wake;
			activeGraceTimer = timer;
		};
		if (platform === "win32") {
			await terminateWindowsTree({
				child,
				startedAtMs,
				getExitedAtMs: () => exitedAtMs,
				getRootStartTime: () => rootStartTime,
				waitForRootCapture: () => rootCapturePromise,
				isForceRequested: () => forceRequested,
				registerGraceWake,
				options,
			});
		} else {
			await terminatePosixTree({
				child,
				detached: options.detached,
				isForceRequested: () => forceRequested,
				registerGraceWake,
				options,
			});
		}
		detach();
	};

	return {
		terminate(terminateOptions?: TerminateNodeProcessTreeOptions): Promise<void> {
			const force = terminateOptions?.force === true;
			if (force && !forceRequested) {
				forceRequested = true;
				if (activeGraceTimer) {
					clearTimeout(activeGraceTimer);
					activeGraceTimer = undefined;
				}
				wakeGraceWait?.();
			}
			if (!activeTermination) {
				activeTermination = runTerminate(force).catch(() => {
					// An unavailable process query must not prevent the caller from settling cancellation.
					detach();
				});
			}
			return activeTermination;
		},
	};
}

function isValidPid(pid: number | undefined): pid is number {
	return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0;
}

function hasChildExited(child: ChildProcess): boolean {
	return child.exitCode !== null || child.signalCode !== null;
}

function isPidAlive(pid: number, options: TrackNodeProcessTreeOptions): boolean {
	if (!isValidPid(pid)) return false;
	if (options.runtime?.isPidAlive) return options.runtime.isPidAlive(pid);
	if ((options.runtime?.platform ?? process.platform) === "linux") {
		try {
			if (/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"))) return false;
		} catch {
			return false;
		}
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { code?: unknown }).code === "EPERM"
		);
	}
}

function canUseFastAlive(options: TrackNodeProcessTreeOptions): boolean {
	return Boolean(options.runtime?.isPidAlive) || (options.runtime?.platform ?? process.platform) === process.platform;
}

function sendPosixSignal(pid: number, signal: NodeJS.Signals, options: TrackNodeProcessTreeOptions): void {
	try {
		if (options.runtime?.sendSignal) options.runtime.sendSignal(pid, signal);
		else process.kill(pid, signal);
	} catch {
		// Ignore ESRCH when process or group already exited.
	}
}

function collectDescendants(
	rootPid: number,
	list: readonly ProcessIdentity[],
	acceptEdge: (parent: ProcessIdentity | undefined, child: ProcessIdentity) => boolean = () => true,
): ProcessIdentity[] {
	const byParent = new Map<number, ProcessIdentity[]>();
	for (const item of list) {
		const children = byParent.get(item.parentPid) ?? [];
		children.push(item);
		byParent.set(item.parentPid, children);
	}
	const result: ProcessIdentity[] = [];
	const seen = new Set<number>([rootPid]);
	const collectChildren = (parentPid: number, parent?: ProcessIdentity): void => {
		for (const item of byParent.get(parentPid) ?? []) {
			if (seen.has(item.pid) || !acceptEdge(parent, item)) continue;
			seen.add(item.pid);
			result.push(item);
		}
	};
	collectChildren(rootPid);
	for (const item of result) collectChildren(item.pid, item);
	return result;
}

async function readPosixProcessList(
	options: TrackNodeProcessTreeOptions,
): Promise<readonly ProcessIdentity[] | undefined> {
	if (options.runtime?.readProcessList) return options.runtime.readProcessList();
	const platform = options.runtime?.platform ?? process.platform;
	const includeCommand = platform === "darwin";
	const args = includeCommand ? ["-axo", "pid=,ppid=,pgid=,lstart=,command="] : ["-eo", "pid=,ppid=,pgid=,lstart="];
	const stdout = await new Promise<string | undefined>((resolve) => {
		execFile(
			"ps",
			args,
			{ timeout: PROCESS_QUERY_TIMEOUT_MS, env: { ...process.env, LC_ALL: "C" } },
			(error, output) => resolve(error ? undefined : output),
		);
	});
	if (!stdout) return undefined;
	const parsed: ProcessIdentity[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		const fields = line.trim().split(/\s+/);
		const pid = Number(fields[0]);
		const parentPid = Number(fields[1]);
		const processGroupId = Number(fields[2]);
		const lstart = fields.slice(3, 8).join(" ");
		const startTime = includeCommand ? `${lstart}|${fields.slice(8).join(" ")}` : lstart;
		if (
			!isValidPid(pid) ||
			!Number.isSafeInteger(parentPid) ||
			parentPid < 0 ||
			!isValidPid(processGroupId) ||
			!startTime
		) {
			continue;
		}
		const item: ProcessIdentity = { pid, parentPid, processGroupId, startTime };
		if (platform === "linux") {
			const refined = refineLinuxIdentity(item);
			if (refined) parsed.push(refined);
		} else {
			parsed.push(item);
		}
	}
	return parsed;
}

function refineLinuxIdentity(identity: ProcessIdentity): ProcessIdentity | undefined {
	try {
		const stat = readFileSync(`/proc/${identity.pid}/stat`, "utf8");
		if (/^\d+ \(.*\) Z /.test(stat)) return undefined;
		const end = stat.lastIndexOf(")");
		if (end < 0) return undefined;
		const fields = stat
			.slice(end + 2)
			.trim()
			.split(/\s+/);
		const parentPid = Number(fields[1]);
		const processGroupId = Number(fields[2]);
		const startTicks = fields[19];
		if (parentPid !== identity.parentPid || processGroupId !== identity.processGroupId || !startTicks) {
			return undefined;
		}
		return { ...identity, startTime: `linux-ticks:${startTicks}` };
	} catch {
		return undefined;
	}
}

async function terminatePosixTree(params: {
	readonly child: ChildProcess;
	readonly detached?: boolean;
	readonly isForceRequested: () => boolean;
	readonly registerGraceWake: (wake: () => void, timer: ReturnType<typeof setTimeout>) => void;
	readonly options: TrackNodeProcessTreeOptions;
}): Promise<void> {
	const { child, detached, isForceRequested, registerGraceWake, options } = params;
	const rootPid = child.pid;
	if (!isValidPid(rootPid)) {
		try {
			child.kill?.(isForceRequested() ? "SIGKILL" : "SIGTERM");
		} catch {
			// Ignore already-exited child.
		}
		return;
	}

	const initialList = await readPosixProcessList(options);
	const rootIdentity = !hasChildExited(child) ? initialList?.find((item) => item.pid === rootPid) : undefined;
	const ownedGroup =
		detached === true ||
		(detached !== false &&
			(rootIdentity?.processGroupId === rootPid ||
				Boolean(initialList?.some((item) => item.processGroupId === rootPid))));
	const knownMembers = new Map<number, ProcessIdentity>();
	if (initialList) {
		if (rootIdentity) {
			knownMembers.set(rootPid, rootIdentity);
			for (const item of collectDescendants(rootPid, initialList)) knownMembers.set(item.pid, item);
		}
		if (ownedGroup) {
			for (const item of initialList) {
				if (item.processGroupId === rootPid) knownMembers.set(item.pid, item);
			}
		}
	}

	const signalVerifiedPosix = (signal: NodeJS.Signals, members: ReadonlyMap<number, ProcessIdentity>): void => {
		const hasGroupMember = [...members.values()].some((item) => item.processGroupId === rootPid);
		if (ownedGroup && (hasGroupMember || (!initialList && !hasChildExited(child)))) {
			sendPosixSignal(-rootPid, signal, options);
		}
		for (const item of [...members.values()].reverse()) {
			if (item.pid === rootPid || (ownedGroup && item.processGroupId === rootPid)) continue;
			sendPosixSignal(item.pid, signal, options);
		}
		if (!ownedGroup) {
			if (members.has(rootPid)) sendPosixSignal(rootPid, signal, options);
			else if (!initialList && !hasChildExited(child)) {
				try {
					child.kill?.(signal);
				} catch {
					// Ignore already-exited child.
				}
			}
		}
	};

	const filterAlivePosixMembers = async (): Promise<Map<number, ProcessIdentity>> => {
		const currentList = await readPosixProcessList(options);
		if (!currentList) return new Map();
		const byPid = new Map(currentList.map((item) => [item.pid, item]));
		const alive = new Map<number, ProcessIdentity>();
		for (const [pid, known] of knownMembers) {
			const cur = byPid.get(pid);
			if (cur && cur.startTime === known.startTime && cur.processGroupId === known.processGroupId) {
				alive.set(pid, cur);
			}
		}
		return alive;
	};

	const hasRemainingPosix = async (): Promise<boolean> => {
		if (!hasChildExited(child) && isPidAlive(rootPid, options)) return true;
		for (const pid of knownMembers.keys()) {
			if (isPidAlive(pid, options)) return true;
		}
		if (ownedGroup && !options.runtime?.isPidAlive) {
			const list = await readPosixProcessList(options);
			if (list?.some((item) => item.processGroupId === rootPid)) return true;
		}
		return false;
	};

	await runGracefulThenForce({
		child,
		options,
		isForceRequested,
		registerGraceWake,
		isDone: async () => !(await hasRemainingPosix()),
		sendGraceful: () => signalVerifiedPosix("SIGTERM", knownMembers),
		sendForce: async () => {
			const verified = initialList ? await filterAlivePosixMembers() : knownMembers;
			signalVerifiedPosix("SIGKILL", verified);
		},
	});
}

function runPowerShell(script: string, timeoutMs: number, maxBuffer = 1024 * 1024): Promise<string | undefined> {
	const executable = join(
		process.env.SystemRoot ?? "C:\\Windows",
		"System32",
		"WindowsPowerShell",
		"v1.0",
		"powershell.exe",
	);
	return new Promise((resolve) => {
		execFile(
			executable,
			["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
			{ encoding: "utf8", timeout: timeoutMs, maxBuffer, windowsHide: true },
			(error, stdout) => resolve(error || !stdout ? undefined : stdout),
		);
	});
}

function parseWindowsCreationTicks(startTime: string): bigint | undefined {
	try {
		return startTime.startsWith(WINDOWS_START_TIME_PREFIX)
			? BigInt(startTime.slice(WINDOWS_START_TIME_PREFIX.length)) * TICKS_PER_MICROSECOND + DOTNET_UNIX_EPOCH_TICKS
			: BigInt(startTime);
	} catch {
		return undefined;
	}
}

function parseWindowsCreationTimeMs(startTime: string): number | undefined {
	const ticks = parseWindowsCreationTicks(startTime);
	if (ticks === undefined) return undefined;
	const ms = Number((ticks - DOTNET_UNIX_EPOCH_TICKS) / TICKS_PER_MILLISECOND);
	return Number.isSafeInteger(ms) ? ms : undefined;
}

function isSameWindowsCreationTime(left: string, right: string): boolean {
	if (left === right) return true;
	const leftTicks = parseWindowsCreationTicks(left);
	const rightTicks = parseWindowsCreationTicks(right);
	if (leftTicks === undefined || rightTicks === undefined) return false;
	const diff = leftTicks >= rightTicks ? leftTicks - rightTicks : rightTicks - leftTicks;
	return diff <= WINDOWS_TICK_TOLERANCE;
}

function ticksToStartTime(rawTicks: string | undefined): string | undefined {
	if (!rawTicks) return undefined;
	if (rawTicks.startsWith(WINDOWS_START_TIME_PREFIX)) return rawTicks;
	try {
		return `${WINDOWS_START_TIME_PREFIX}${(BigInt(rawTicks) - DOTNET_UNIX_EPOCH_TICKS) / TICKS_PER_MICROSECOND}`;
	} catch {
		return undefined;
	}
}

async function captureWindowsRootStartTime(
	pid: number,
	options: TrackNodeProcessTreeOptions,
): Promise<string | undefined> {
	if (options.runtime?.captureWindowsRootStartTime) {
		return await options.runtime.captureWindowsRootStartTime(pid);
	}
	if (options.runtime?.readProcessListAsync) {
		const list = await options.runtime.readProcessListAsync();
		return list?.find((item) => item.pid === pid)?.startTime;
	}
	const stdout = await runPowerShell(
		`$p=$null;try{$p=[System.Diagnostics.Process]::GetProcessById(${pid});$null=$p.Handle;$p.StartTime.ToUniversalTime().Ticks}catch{}finally{if($null -ne $p){$p.Dispose()}}`,
		PROCESS_QUERY_TIMEOUT_MS,
	);
	return ticksToStartTime(stdout?.trim());
}

async function readWindowsProcessListAsync(
	options: TrackNodeProcessTreeOptions,
): Promise<readonly ProcessIdentity[] | undefined> {
	if (options.runtime?.readProcessListAsync) {
		return await options.runtime.readProcessListAsync().catch(() => undefined);
	}
	const stdout = await runPowerShell(
		"Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToUniversalTime().Ticks }",
		PROCESS_QUERY_TIMEOUT_MS,
		4 * 1024 * 1024,
	);
	if (!stdout) return undefined;
	const list: ProcessIdentity[] = [];
	for (const line of stdout.split(/\r?\n/)) {
		const [pidText, parentText, ticksText] = line.trim().split(/\s+/);
		const pid = Number(pidText);
		const parentPid = Number(parentText);
		const startTime = ticksToStartTime(ticksText);
		if (!isValidPid(pid) || !Number.isSafeInteger(parentPid) || parentPid < 0 || !startTime) continue;
		list.push({ pid, parentPid, startTime });
	}
	return list.length > 0 ? list : undefined;
}

async function signalWindowsProcessesWithBoundHandles(
	request: WindowsProcessSignalRequest,
	options: TrackNodeProcessTreeOptions,
): Promise<readonly number[]> {
	if (request.targets.length === 0) return [];
	if (options.runtime?.signalWindowsProcesses) {
		return await options.runtime.signalWindowsProcesses(request);
	}
	const pairs: string[] = [];
	for (const target of request.targets) {
		const ticks = parseWindowsCreationTicks(target.startTime);
		if (isValidPid(target.pid) && ticks !== undefined) {
			pairs.push(`@{Id=${target.pid};Ticks=${ticks}L}`);
		}
	}
	if (pairs.length === 0) return [];
	const action = request.force ? "$process.Kill()" : "$null = $process.CloseMainWindow()";
	// Acquire .Handle (PROCESS_ALL_ACCESS) first so .NET Framework caches one kernel handle across StartTime and Kill.
	const script = `
$targets = @(${pairs.join(",")})
foreach ($target in $targets) {
    $process = $null
    try {
        $process = [System.Diagnostics.Process]::GetProcessById($target.Id)
        $null = $process.Handle
        $ticks = $process.StartTime.ToUniversalTime().Ticks
        if ([Math]::Abs($ticks - $target.Ticks) -le ${WINDOWS_TICK_TOLERANCE}L) {
            ${action}
            Write-Output $target.Id
        }
    } catch {} finally { if ($null -ne $process) { $process.Dispose() } }
}`;
	const stdout = await runPowerShell(script, request.timeoutMs);
	return (stdout ?? "")
		.split(/\r?\n/)
		.map((line) => Number(line.trim()))
		.filter((pid) => isValidPid(pid));
}

async function terminateWindowsTree(params: {
	readonly child: ChildProcess;
	readonly startedAtMs: number;
	readonly getExitedAtMs: () => number | undefined;
	readonly getRootStartTime: () => string | undefined;
	readonly waitForRootCapture: () => Promise<void> | undefined;
	readonly isForceRequested: () => boolean;
	readonly registerGraceWake: (wake: () => void, timer: ReturnType<typeof setTimeout>) => void;
	readonly options: TrackNodeProcessTreeOptions;
}): Promise<void> {
	const { child, startedAtMs, getExitedAtMs, getRootStartTime, waitForRootCapture, options } = params;
	const rootPid = child.pid;
	if (!isValidPid(rootPid)) {
		try {
			child.kill?.();
		} catch {
			// Ignore already-exited child.
		}
		return;
	}
	await waitForRootCapture();
	const recorded = getRootStartTime();
	const known = new Map<number, ProcessIdentity>();
	let rootReused = false;
	const rootIsRunning = () => !hasChildExited(child) && getExitedAtMs() === undefined;

	const discoverVerified = async (): Promise<ProcessIdentity[]> => {
		const list = await readWindowsProcessListAsync(options);
		if (!list) return [...known.values()]; // The signal helper still verifies every process handle.
		const root = list.find((item) => item.pid === rootPid);
		const rootMatches =
			recorded !== undefined && root !== undefined && isSameWindowsCreationTime(root.startTime, recorded);
		if (recorded !== undefined && root !== undefined && !rootMatches) rootReused = true;
		const exitedAtMs = getExitedAtMs();
		const lowerBound = (recorded && parseWindowsCreationTimeMs(recorded)) || startedAtMs;
		if (rootMatches && rootIsRunning()) known.set(rootPid, root);
		if (rootMatches || (recorded !== undefined && !rootReused && exitedAtMs !== undefined)) {
			for (const candidate of collectDescendants(rootPid, list, (parent, member) => {
				const created = parseWindowsCreationTimeMs(member.startTime);
				const previous = known.get(member.pid);
				if (previous && !isSameWindowsCreationTime(member.startTime, previous.startTime)) return false;
				const parentStart = parent ? parseWindowsCreationTimeMs(parent.startTime) : lowerBound;
				return (
					created !== undefined &&
					parentStart !== undefined &&
					created >= parentStart &&
					(exitedAtMs === undefined || created <= exitedAtMs)
				);
			})) {
				// Keep the original identity if a previously owned PID has been recycled.
				if (!known.has(candidate.pid)) known.set(candidate.pid, candidate);
			}
		}
		const byPid = new Map(list.map((item) => [item.pid, item]));
		return [...known.values()].filter((item) => {
			const current = byPid.get(item.pid);
			return current !== undefined && isSameWindowsCreationTime(current.startTime, item.startTime);
		});
	};

	let discovered = await discoverVerified();
	const killRootFallback = (): void => {
		if (!rootReused && rootIsRunning()) {
			try {
				child.kill?.();
			} catch {
				// Ignore already-exited child.
			}
		}
	};

	const isTreeGone = async (): Promise<boolean> => {
		if (!rootReused && rootIsRunning()) return false;
		if (discovered.length === 0) return true;
		if (canUseFastAlive(options)) {
			return discovered.every((item) => !isPidAlive(item.pid, options));
		}
		const list = await readWindowsProcessListAsync(options);
		if (!list) return false;
		const byPid = new Map(list.map((item) => [item.pid, item]));
		return discovered.every((item) => {
			const current = byPid.get(item.pid);
			return !current || !isSameWindowsCreationTime(current.startTime, item.startTime);
		});
	};

	const signalTargets = async (force: boolean): Promise<void> => {
		const signalled = await signalWindowsProcessesWithBoundHandles(
			{ force, targets: [...discovered].reverse(), timeoutMs: PROCESS_QUERY_TIMEOUT_MS },
			options,
		);
		if (force && !signalled.includes(rootPid)) killRootFallback();
	};

	await runGracefulThenForce({
		child,
		options,
		isForceRequested: params.isForceRequested,
		registerGraceWake: params.registerGraceWake,
		isDone: isTreeGone,
		sendGraceful: () => signalTargets(false),
		sendForce: async () => {
			discovered = await discoverVerified();
			await signalTargets(true);
		},
	});
}

async function runGracefulThenForce(params: {
	readonly child: ChildProcess;
	readonly options: TrackNodeProcessTreeOptions;
	readonly isForceRequested: () => boolean;
	readonly registerGraceWake: (wake: () => void, timer: ReturnType<typeof setTimeout>) => void;
	readonly isDone: () => boolean | Promise<boolean>;
	readonly sendGraceful: () => void | Promise<void>;
	readonly sendForce: () => void | Promise<void>;
}): Promise<void> {
	const { child, options, isForceRequested, registerGraceWake, isDone, sendGraceful, sendForce } = params;
	const forceAfterMs = Math.max(options.forceAfterMs ?? DEFAULT_FORCE_AFTER_MS, 0);
	if (!isForceRequested() && forceAfterMs > 0) {
		await sendGraceful();
		if (!(await isDone())) {
			await waitBounded(forceAfterMs, async () => isForceRequested() || (await isDone()), child, registerGraceWake);
		}
	}
	if (isForceRequested() || !(await isDone())) {
		await sendForce();
		const waitAfterForceMs = Math.max(options.waitAfterForceMs ?? DEFAULT_WAIT_AFTER_FORCE_MS, 0);
		if (waitAfterForceMs > 0 && !(await isDone())) {
			await waitBounded(waitAfterForceMs, isDone, child);
		}
	}
}

function waitBounded(
	timeoutMs: number,
	isDone: () => boolean | Promise<boolean>,
	child: ChildProcess,
	registerWake?: (wake: () => void, timer: ReturnType<typeof setTimeout>) => void,
): Promise<void> {
	return new Promise<void>((resolve) => {
		let finished = false;
		let checking = false;
		const cleanup = (): void => {
			clearInterval(poll);
			clearTimeout(deadline);
			child.off?.("exit", check);
		};
		const done = (): void => {
			if (finished) return;
			finished = true;
			cleanup();
			resolve();
		};
		const check = (): void => {
			if (finished || checking) return;
			const result = isDone();
			if (typeof result === "boolean") {
				if (result) done();
				return;
			}
			checking = true;
			void result
				.then((ready) => {
					if (ready) done();
				})
				.catch(() => undefined)
				.finally(() => {
					checking = false;
				});
		};
		const poll = setInterval(check, POLL_INTERVAL_MS);
		const deadline = setTimeout(done, timeoutMs);
		registerWake?.(done, deadline);
		child.once?.("exit", check);
		check();
	});
}
