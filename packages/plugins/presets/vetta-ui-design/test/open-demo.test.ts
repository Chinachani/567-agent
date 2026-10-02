import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContext } from "@vetta-org/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoTempFileName, openHtmlDemoInBrowser, OPEN_DEMO_SCRIPT } from "../src/gallery/open-demo";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("demoTempFileName", () => {
	it("只保留 slug 字符，防止拼进临时路径的名字带穿越", () => {
		expect(demoTempFileName("linear")).toBe("567agent-demo-linear.html");
		expect(demoTempFileName("../..//etc")).toBe("567agent-demo-etc.html");
		expect(demoTempFileName("!!!")).toBe("567agent-demo-demo.html");
	});
});

describe("openHtmlDemoInBrowser", () => {
	it("stages large HTML in the workspace, passes only its path, then removes the staging file", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "567-demo-open-"));
		directories.push(workspace);
		const html = `<html>${"x".repeat(32_000)}</html>`;
		const commandRun = vi.fn(async (_file: string, _args: readonly string[], options?: { env?: Record<string, string> }) => {
			const sourcePath = options?.env?.VETD_DEMO_SOURCE;
			expect(sourcePath).toBeTruthy();
			if (!sourcePath) throw new Error("expected demo staging path");
			expect(await readFile(sourcePath, "utf8")).toBe(html);
			expect(JSON.stringify(options?.env ?? {}).length).toBeLessThan(512);
			return { exitCode: 0, stdout: "", stderr: "" };
		});
		const context = {
			command: { run: commandRun },
			fs: {
				writeFile: (path: string, content: string) => writeFile(path, content),
				delete: (path: string) => rm(path, { force: true }),
			},
			official: { projects: { list: async () => ({ workspacePath: workspace, projects: [], archivedProjects: [] }) } },
		} as unknown as PluginContext;

		await openHtmlDemoInBrowser(context, html, "test");

		const sourcePath = commandRun.mock.calls[0]?.[2]?.env?.VETD_DEMO_SOURCE;
		expect(sourcePath).toBeTruthy();
		if (sourcePath) await expect(stat(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("cleans up the staging file when launching the browser fails", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "567-demo-open-fail-"));
		directories.push(workspace);
		const commandRun = vi.fn(async () => ({ exitCode: 1, stdout: "", stderr: "failed" }));
		const context = {
			command: { run: commandRun },
			fs: {
				writeFile: (path: string, content: string) => writeFile(path, content),
				delete: (path: string) => rm(path, { force: true }),
			},
			official: { projects: { list: async () => ({ workspacePath: workspace, projects: [], archivedProjects: [] }) } },
		} as unknown as PluginContext;

		await expect(openHtmlDemoInBrowser(context, "<html></html>", "test")).rejects.toThrow("failed");
		const sourcePath = commandRun.mock.calls[0]?.[2]?.env?.VETD_DEMO_SOURCE;
		expect(sourcePath).toBeTruthy();
		if (sourcePath) await expect(stat(sourcePath)).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("OPEN_DEMO_SCRIPT", () => {
	it("copies the staged source and opens only a basename in the default browser", () => {
		expect(OPEN_DEMO_SCRIPT).toContain("VETD_DEMO_SOURCE");
		expect(OPEN_DEMO_SCRIPT).toContain("VETD_DEMO_FILE");
		expect(OPEN_DEMO_SCRIPT).toContain("copyFileSync");
		expect(OPEN_DEMO_SCRIPT).toContain("path.basename");
		expect(OPEN_DEMO_SCRIPT).not.toContain("VETD_DEMO_HTML");
		expect(OPEN_DEMO_SCRIPT).toContain("process.exit(2)");
	});
});
