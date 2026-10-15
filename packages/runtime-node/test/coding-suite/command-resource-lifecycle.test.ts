import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnGuardedCommand } from "../../src/coding/host/guarded-command-process.js";
import { killNodeProcessTree } from "../../src/coding/host/process-tree.js";
import { createNodeCommandExecutor } from "../../src/host/command-executor.js";

const roots: string[] = [];
const processes = new Set<number>();
function fixture(source: (marker: string) => string) {
	const root = mkdtempSync(join(tmpdir(), "567-command-flow-"));
	roots.push(root);
	const marker = join(root, "ready.json");
	const script = join(root, "process.cjs");
	writeFileSync(script, source(marker));
	return { root, script, marker };
}
async function ready(marker: string): Promise<{ parent: number; child?: number }> {
	let data = { parent: 0, child: undefined as number | undefined };
	await vi.waitFor(
		() => {
			data = JSON.parse(readFileSync(marker, "utf8"));
			expect(data.parent).toBeGreaterThan(0);
		},
		{ timeout: 2000, interval: 10 },
	);
	processes.add(data.parent);
	if (data.child) processes.add(data.child);
	return data;
}
function alive(pid: number) {
	try {
		process.kill(pid, 0);
		return process.platform !== "linux" || !/^\d+ \(.*\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
	} catch {
		return false;
	}
}
afterEach(() => {
	for (const pid of processes) killNodeProcessTree(pid);
	processes.clear();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	vi.unstubAllEnvs();
});
describe.skipIf(process.platform === "win32")("bounded command process ownership", () => {
	it("returns ordinary stdout, stderr and nonzero status without calling it cancelled", async () => {
		const result = await createNodeCommandExecutor().execute(
			process.execPath,
			["-e", "process.stdout.write('ok');process.stderr.write('err');process.exit(7)"],
			tmpdir(),
			{ timeout: 2000 },
		);
		expect(result).toEqual({ stdout: "ok", stderr: "err", code: 7, killed: false });
	});
	it("timeout stops a TERM-ignoring command and its child", async () => {
		const f = fixture(
			(marker) =>
				`const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');process.on('SIGTERM',()=>{});const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});writeFileSync(${JSON.stringify(marker)},JSON.stringify({parent:process.pid,child:c.pid}));setInterval(()=>{},1000);`,
		);
		const pending = createNodeCommandExecutor().execute(process.execPath, [f.script], f.root, { timeout: 500 });
		const p = await ready(f.marker);
		expect(await pending).toMatchObject({ killed: true, code: 143 });
		await vi.waitFor(
			() => {
				expect(alive(p.parent)).toBe(false);
				expect(alive(p.child!)).toBe(false);
			},
			{ timeout: 2000 },
		);
	});
	it("cancels descendants which retain pipes after their parent exits", async () => {
		const f = fixture(
			(marker) =>
				`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]});require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({parent:process.pid,child:c.pid}));c.unref();process.exit(0);`,
		);
		const controller = new AbortController();
		const pending = createNodeCommandExecutor().execute(process.execPath, [f.script], f.root, {
			timeout: 3000,
			signal: controller.signal,
		});
		const p = await ready(f.marker);
		await vi.waitFor(() => expect(alive(p.parent)).toBe(false));
		controller.abort();
		expect(await pending).toMatchObject({ killed: true, code: 143 });
		await vi.waitFor(() => expect(alive(p.child!)).toBe(false));
	});
	it("continues enforcing output after root exit", async () => {
		vi.stubEnv("AGENT567_COMMAND_OUTPUT_MB", "1");
		const f = fixture(
			() =>
				`const c=require('node:child_process').spawn(process.execPath,['-e',"process.stdout.write('x'.repeat(2*1024*1024));"],{stdio:['ignore',1,2]});c.unref();process.exit(0);`,
		);
		const result = await createNodeCommandExecutor().execute(process.execPath, [f.script], f.root, { timeout: 3000 });
		expect(result.code).not.toBe(0);
		expect(result.stdout.length).toBeLessThanOrEqual(1024 * 1024);
	});
	it("the shared guard keeps output ownership until descendant pipes close", async () => {
		vi.stubEnv("AGENT567_COMMAND_OUTPUT_MB", "1");
		const f = fixture(
			() =>
				`const c=require('node:child_process').spawn(process.execPath,['-e',"const root=Number(process.argv[1]);function write(){try{process.kill(root,0);setImmediate(write)}catch{process.stdout.write('x'.repeat(2*1024*1024));}}write()",String(process.pid)],{stdio:['ignore',1,2]});c.unref();process.exit(0);`,
		);
		const child = spawnGuardedCommand(process.execPath, [f.script], {
			cwd: f.root,
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (child.pid) processes.add(child.pid);
		const result = await new Promise<Error | null>((resolve, reject) => {
			const timer = setTimeout(() => {
				if (child.pid) killNodeProcessTree(child.pid);
				reject(new Error("guard did not settle"));
			}, 3000);
			let failure: Error | null = null;
			child.on("error", (error) => {
				failure = error;
			});
			child.once("close", () => {
				clearTimeout(timer);
				resolve(failure);
			});
		});
		expect(result?.message).toContain("Command output exceeded");
	});

	it("never projects signal termination as success", async () => {
		const result = await createNodeCommandExecutor().execute(
			process.execPath,
			["-e", "process.kill(process.pid,'SIGTERM')"],
			tmpdir(),
			{ timeout: 2000 },
		);
		expect(result.code).not.toBe(0);
		expect(result.killed).toBe(true);
	});
	it.runIf(process.platform === "linux")(
		"starts Node 24 with low resident budgets while retaining a kernel allocation ceiling",
		async () => {
			for (const budget of [128, 256, 512]) {
				vi.stubEnv("AGENT567_COMMAND_MEMORY_MB", String(budget));
				const result = await createNodeCommandExecutor().execute(
					process.execPath,
					["-e", "console.log('ready')"],
					tmpdir(),
					{ timeout: 3000 },
				);
				expect(result).toMatchObject({ code: 0, stdout: "ready\n", killed: false });
			}
		},
	);
});
