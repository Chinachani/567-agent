import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPluginCommand, stopPluginCommandRuns } from "./command-runner";
import { stopAllSpawnsForPlugin } from "./command-spawner";

vi.mock("electron", () => ({ webContents: { getAllWebContents: () => [] } }));
vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info: () => undefined, warn: () => undefined }) }));
vi.mock("./plugin-catalog.js", () => ({
	listPlugins: () => [
		{
			id: "flow-test",
			enabled: true,
			permissions: ["agent.command.run"],
			grantedPermissions: ["agent.command.run"],
			declaredCommands: [process.execPath],
			grantedCommandNames: [process.execPath],
		},
	],
}));
let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "567-plugin-flow-"));
	vi.stubEnv("AGENT567_CODING_AGENT_DIR", join(root, "agent"));
});
afterEach(() => {
	stopPluginCommandRuns();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});
async function ready(marker: string) {
	let pid = 0;
	await vi.waitFor(
		() => {
			pid = Number(readFileSync(marker, "utf8"));
			expect(pid).toBeGreaterThan(0);
		},
		{ timeout: 2000, interval: 10 },
	);
	return pid;
}
function runningSource(marker: string) {
	return `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`;
}
describe.skipIf(process.platform === "win32")("plugin command ownership", () => {
	it("returns stdout and a normal nonzero exit", async () => {
		expect(
			await runPluginCommand("flow-test", process.execPath, ["-e", "process.stdout.write('ok');process.exit(7)"], {
				cwd: root,
			}),
		).toEqual({ stdout: "ok", stderr: "", exitCode: 7 });
	});
	it("times out even when the child ignores TERM", async () => {
		const marker = join(root, "ready");
		const script = join(root, "loop.cjs");
		writeFileSync(script, runningSource(marker));
		const result = runPluginCommand("flow-test", process.execPath, [script], { cwd: root, timeoutMs: 500 }).catch(
			(error: Error) => error,
		);
		await ready(marker);
		expect(await result).toBeInstanceOf(Error);
		expect(((await result) as Error).message).toContain("timed out");
	});
	it("stops an in-flight run through plugin disable cleanup", async () => {
		const marker = join(root, "ready");
		const result = runPluginCommand("flow-test", process.execPath, ["-e", runningSource(marker)], {
			cwd: root,
		}).catch((error: Error) => error);
		await ready(marker);
		stopAllSpawnsForPlugin("flow-test");
		expect(((await result) as Error).message).toContain("cancelled");
	});
	it("rejects excess output instead of buffering indefinitely", async () => {
		await expect(
			runPluginCommand(
				"flow-test",
				process.execPath,
				[
					"-e",
					"process.on('SIGTERM',()=>{});function write(){process.stdout.write('x'.repeat(65536));setImmediate(write)}write()",
				],
				{ cwd: root, timeoutMs: 3000 },
			),
		).rejects.toThrow("output exceeded");
	});
});
