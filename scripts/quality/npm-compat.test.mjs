import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { packages } from "../generate-npm-compat.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));

describe("new npm scope", () => {
	it("preserves every public entry and pins the single original implementation", async () => {
		for (const [name, directory] of Object.entries(packages)) {
			const original = JSON.parse(await readFile(join(root, directory, "package.json"), "utf8"));
			const wrapperDir = join(root, "packages/npm-compat", name);
			const wrapper = JSON.parse(await readFile(join(wrapperDir, "package.json"), "utf8"));
			expect(Object.keys(wrapper.exports).sort()).toEqual(Object.keys(original.exports).sort());
			expect(wrapper.dependencies).toEqual({ [original.name]: original.version });
			expect(wrapper.license).toBe("Apache-2.0");
			for (const file of ["LICENSE", "NOTICE"]) {
				expect(wrapper.files).toContain(file);
				expect(await readFile(join(wrapperDir, file))).toEqual(await readFile(join(root, file)));
			}
			for (const [key, value] of Object.entries(wrapper.exports)) {
				if (key.endsWith(".css")) {
					expect(await readFile(join(wrapperDir, value))).toEqual(
						await readFile(join(root, directory, original.exports[key])),
					);
				} else {
					const entry = typeof value === "string" ? value : value.import;
					expect(await readFile(join(wrapperDir, entry), "utf8")).toContain(
						`export * from "${original.name}${key === "." ? "" : key.slice(1)}"`,
					);
				}
			}
		}
	});

	it("loads the actual new package roots and subpaths with unchanged export identity", () => {
		// Bun supports the original UI packages' published TypeScript entry points.
		const program = `
		import assert from "node:assert/strict";
		for (const name of ["capability-sdk", "plugin-sdk", "plugin-vite", "plugin-cli", "ui/utils", "theme-sdk/storage"]) {
			const oldModule = await import("@vetta-org/" + name);
			const newModule = await import("@567agent/" + name);
			assert.deepEqual(Object.keys(newModule), Object.keys(oldModule));
			for (const key of Object.keys(oldModule)) assert.equal(newModule[key], oldModule[key], name + ":" + key);
		}
		`;
		execFileSync("bun", ["--eval", program], { cwd: root, stdio: "pipe" });
	});

	it("runs both new CLI entry points without private package imports", () => {
		for (const name of ["plugin-vite", "plugin-cli"]) {
			const directory = join(root, "packages/npm-compat", name);
			const bin = name === "plugin-vite" ? "vetta-plugin" : "vetta-plugin-cli";
			const original = spawnSync(process.execPath, [join(root, packages[name], "dist/cli.js"), "--help"], {
				cwd: root,
				encoding: "utf8",
			});
			const forwarded = spawnSync(process.execPath, [join(directory, `dist/bin/${bin}.js`), "--help"], {
				cwd: root,
				encoding: "utf8",
			});
			expect(forwarded.error).toBeUndefined();
			expect(forwarded.status).toBe(original.status);
			expect(forwarded.stdout).toBe(original.stdout);
			expect(forwarded.stderr).toBe(original.stderr);
			expect(`${forwarded.stdout}${forwarded.stderr}`.toLowerCase()).toContain("usage");
		}
	});
});
