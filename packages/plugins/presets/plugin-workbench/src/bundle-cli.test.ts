import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("fails a fresh build without the CLI, then copies and preserves a usable bundled companion", () => {
	const root = mkdtempSync(join(tmpdir(), "agent567-workbench-cli-"));
	try {
		const scripts = join(root, "scripts");
		mkdirSync(scripts);
		const script = join(scripts, "bundle-cli.mjs");
		copyFileSync(fileURLToPath(new URL("../scripts/bundle-cli.mjs", import.meta.url)), script);
		const source = join(root, "compiled-cli.js");
		const run = () =>
			spawnSync(process.execPath, [script], {
				cwd: root,
				encoding: "utf8",
				env: { ...process.env, AGENT567_PLUGIN_CLI_DIST: source },
			});
		const absent = run();
		expect(absent.status).not.toBe(0);
		expect(absent.stderr).toContain("Build plugin-cli before packaging");
		writeFileSync(source, 'console.log("bundled CLI");\n');
		expect(run().status).toBe(0);
		const installed = join(root, "agent", "cli", "vetta-plugin-cli.js");
		expect(readFileSync(installed, "utf8")).toBe(readFileSync(source, "utf8"));
		rmSync(source);
		expect(run().status).toBe(0);
		expect(spawnSync(process.execPath, [installed], { encoding: "utf8" }).stdout.trim()).toBe("bundled CLI");
	} finally {
		rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
	}
});
