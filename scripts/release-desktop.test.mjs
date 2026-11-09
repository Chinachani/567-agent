import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const script = fileURLToPath(new URL("./release-desktop.mjs", import.meta.url));
it.each(["patch", "minor", "unknown"])("retires the %s entry without writes or child commands", (mode) => {
	const cwd = mkdtempSync(join(tmpdir(), "release-entry-"));
	try {
		writeFileSync(join(cwd, "candidate.txt"), "unchanged");
		// Empty PATH guarantees accidental git/bun execution cannot publish.
		const result = spawnSync(process.execPath, [script, mode], {
			cwd,
			encoding: "utf8",
			env: { ...process.env, PATH: "" },
		});
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("入口已停用");
		expect(result.stderr).toContain("release-preflight.mjs");
		expect(result.stderr).toContain("annotated");
		expect(result.stderr).not.toMatch(/ENOENT|spawnSync/);
		expect(readdirSync(cwd)).toEqual(["candidate.txt"]);
		expect(readFileSync(join(cwd, "candidate.txt"), "utf8")).toBe("unchanged");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
