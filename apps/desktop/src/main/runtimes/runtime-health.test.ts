import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodePackageManagerPaths, probeManagedRuntime, probeRuntimeExecutable } from "./runtime-health";
import { writeNodeRuntimeFixture } from "./runtime-test-fixtures";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("probeRuntimeExecutable", () => {
	it("requires an executable to return the exact expected version", () => {
		expect(probeRuntimeExecutable(process.execPath, process.version.slice(1))).toMatchObject({
			ready: true,
			detectedVersion: process.version.slice(1),
		});
		expect(probeRuntimeExecutable(process.execPath, "0.0.0").ready).toBe(false);
	});

	it("reports missing or non-runnable runtime files as not ready", () => {
		expect(probeRuntimeExecutable("/path/that/does/not/exist", "22.22.2")).toMatchObject({ ready: false });
	});
});

describe("managed Node health", () => {
	it.each(process.platform === "win32" ? [true] : [false, true])(
		"checks the npm tree in the correct layout (Windows: %s)",
		async (windowsLayout) => {
			const root = await mkdtemp(join(tmpdir(), "567-runtime-health-"));
			roots.push(root);
			const executablePath = await writeNodeRuntimeFixture(root, windowsLayout);
			const version = process.version.slice(1);
			expect(probeManagedRuntime("node", executablePath, version).ready).toBe(true);
			const { npmCli } = nodePackageManagerPaths(executablePath);
			await rm(npmCli);
			expect(probeRuntimeExecutable(executablePath, version).ready).toBe(true);
			expect(probeManagedRuntime("node", executablePath, version)).toMatchObject({
				ready: false,
				error: expect.stringContaining("npm-cli.js"),
			});
		},
	);

	it("rejects npm with missing dependencies even when both entry files exist", async () => {
		const root = await mkdtemp(join(tmpdir(), "567-runtime-health-"));
		roots.push(root);
		const executablePath = await writeNodeRuntimeFixture(root);
		const { npmCli } = nodePackageManagerPaths(executablePath);
		await rm(join(dirname(npmCli), "..", "package.json"));
		expect(probeManagedRuntime("node", executablePath, process.version.slice(1))).toMatchObject({
			ready: false,
			error: expect.stringContaining("MODULE_NOT_FOUND"),
		});
	});
});
