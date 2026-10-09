import { spawnSync } from "node:child_process";
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installRuntimeArchive, installRuntimeDirectory } from "./runtime-archive-installer";

let testRoot = "";
const fixtureVersion = process.platform === "win32" ? process.version.slice(1) : "22.22.2";

async function writeRuntimeFixture(path: string): Promise<void> {
	if (process.platform === "win32") {
		await copyFile(process.execPath, path);
		return;
	}
	await writeFile(path, `#!/bin/sh\necho v${fixtureVersion}\n`, "utf8");
	await chmod(path, 0o755);
}

beforeEach(async () => {
	testRoot = await mkdtemp(join(tmpdir(), "vetta-runtime-archive-"));
});

afterEach(async () => {
	await rm(testRoot, { recursive: true, force: true });
});

describe("installRuntimeArchive", () => {
	it("extracts a complete runtime before replacing the target directory", async () => {
		const sourceRoot = join(testRoot, "source");
		const sourceRuntime = join(sourceRoot, "runtime", "bin");
		await mkdir(sourceRuntime, { recursive: true });
		await writeRuntimeFixture(join(sourceRuntime, "node"));

		const archivePath = join(testRoot, "runtime.tar.gz");
		const archive = spawnSync("tar", ["-czf", archivePath, "-C", sourceRoot, "runtime"], {
			encoding: "utf8",
		});
		expect(archive.status, archive.stderr || archive.stdout).toBe(0);

		const targetDirectory = join(testRoot, "managed", "22.22.2");
		await mkdir(targetDirectory, { recursive: true });
		await writeFile(join(targetDirectory, "stale"), "stale", "utf8");

		await installRuntimeArchive({
			archivePath,
			archiveType: "tar.gz",
			innerDirectory: "runtime",
			targetDirectory,
			executablePath: join(targetDirectory, "bin", "node"),
			expectedVersion: fixtureVersion,
		});

		await expect(readFile(join(targetDirectory, "bin", "node"))).resolves.toBeInstanceOf(Buffer);
		await expect(readFile(join(targetDirectory, "stale"), "utf8")).rejects.toThrow();
		await expect(readdir(join(testRoot, "managed"))).resolves.toEqual(["22.22.2"]);
	});

	it.runIf(process.platform === "win32")("extracts the Node ZIP format used by Windows releases", async () => {
		const sourceRoot = join(testRoot, "source");
		const sourceRuntime = join(sourceRoot, "node-v22.22.2-win-x64");
		await mkdir(sourceRuntime, { recursive: true });
		await writeRuntimeFixture(join(sourceRuntime, "node.exe"));

		const archivePath = join(testRoot, "node.zip");
		const archive = spawnSync("tar", ["-a", "-cf", archivePath, "-C", sourceRoot, "node-v22.22.2-win-x64"], {
			encoding: "utf8",
		});
		expect(archive.status, archive.stderr || archive.stdout).toBe(0);

		const targetDirectory = join(testRoot, "managed", "22.22.2");
		await installRuntimeArchive({
			archivePath,
			archiveType: "zip",
			innerDirectory: "node-v22.22.2-win-x64",
			targetDirectory,
			executablePath: join(targetDirectory, "node.exe"),
			expectedVersion: fixtureVersion,
		});

		await expect(readFile(join(targetDirectory, "node.exe"))).resolves.toBeInstanceOf(Buffer);
	});

	it("preserves an existing runtime when extraction fails", async () => {
		const targetDirectory = join(testRoot, "managed", "3.13.12");
		await mkdir(targetDirectory, { recursive: true });
		await writeFile(join(targetDirectory, "python.exe"), "existing-runtime", "utf8");
		const archivePath = join(testRoot, "broken.tar.gz");
		await writeFile(archivePath, "not an archive", "utf8");

		await expect(
			installRuntimeArchive({
				archivePath,
				archiveType: "tar.gz",
				innerDirectory: "python",
				targetDirectory,
				executablePath: join(targetDirectory, "bin", "python3"),
				expectedVersion: fixtureVersion,
			}),
		).rejects.toThrow("extract failed");

		await expect(readFile(join(targetDirectory, "python.exe"), "utf8")).resolves.toBe("existing-runtime");
		await expect(readdir(join(testRoot, "managed"))).resolves.toEqual(["3.13.12"]);
	});

	it("preserves an existing runtime when the staged executable fails its version check", async () => {
		const sourceRoot = join(testRoot, "source");
		const sourceRuntime = join(sourceRoot, "runtime", "bin");
		await mkdir(sourceRuntime, { recursive: true });
		await writeRuntimeFixture(join(sourceRuntime, "node"));

		const archivePath = join(testRoot, "runtime.tar.gz");
		const archive = spawnSync("tar", ["-czf", archivePath, "-C", sourceRoot, "runtime"], { encoding: "utf8" });
		expect(archive.status, archive.stderr || archive.stdout).toBe(0);

		const targetDirectory = join(testRoot, "managed", "22.22.2");
		await mkdir(targetDirectory, { recursive: true });
		await writeFile(join(targetDirectory, "node"), "previous-good-runtime", "utf8");

		await expect(
			installRuntimeArchive({
				archivePath,
				archiveType: "tar.gz",
				innerDirectory: "runtime",
				targetDirectory,
				executablePath: join(targetDirectory, "bin", "node"),
				expectedVersion: "0.0.0",
			}),
		).rejects.toThrow("runtime health check failed");

		await expect(readFile(join(targetDirectory, "node"), "utf8")).resolves.toBe("previous-good-runtime");
	});
});

describe("installRuntimeDirectory", () => {
	it("copies a bundled runtime directory over the target", async () => {
		const sourceDirectory = join(testRoot, "vendor", "python");
		await mkdir(join(sourceDirectory, "bin"), { recursive: true });
		await writeRuntimeFixture(join(sourceDirectory, "bin", "python3.13"));

		const targetDirectory = join(testRoot, "managed", "3.13.12");
		await mkdir(targetDirectory, { recursive: true });
		await writeFile(join(targetDirectory, "stale"), "stale", "utf8");

		await installRuntimeDirectory({
			sourceDirectory,
			targetDirectory,
			executablePath: join(targetDirectory, "bin", "python3.13"),
			expectedVersion: fixtureVersion,
		});

		await expect(readFile(join(targetDirectory, "bin", "python3.13"), "utf8")).resolves.toContain(
			`v${fixtureVersion}`,
		);
		await expect(readFile(join(targetDirectory, "stale"), "utf8")).rejects.toThrow();
		await expect(readdir(join(testRoot, "managed"))).resolves.toEqual(["3.13.12"]);
	});

	// python-build-standalone 与 Node 官方包都用符号链接（python3 -> python3.13），
	// 解引用会让运行时体积翻倍，可执行位丢失则 seed 出来的运行时直接不可用。
	it.runIf(process.platform !== "win32")("preserves symlinks and the executable bit", async () => {
		const sourceDirectory = join(testRoot, "vendor", "python");
		await mkdir(join(sourceDirectory, "bin"), { recursive: true });
		const realBinary = join(sourceDirectory, "bin", "python3.13");
		await writeRuntimeFixture(realBinary);
		await chmod(realBinary, 0o755);
		await symlink("python3.13", join(sourceDirectory, "bin", "python3"));

		const targetDirectory = join(testRoot, "managed", "3.13.12");
		await installRuntimeDirectory({
			sourceDirectory,
			targetDirectory,
			executablePath: join(targetDirectory, "bin", "python3"),
			expectedVersion: fixtureVersion,
		});

		const copiedLink = join(targetDirectory, "bin", "python3");
		await expect(lstat(copiedLink).then((info) => info.isSymbolicLink())).resolves.toBe(true);
		await expect(readlink(copiedLink)).resolves.toBe("python3.13");
		const mode = (await lstat(join(targetDirectory, "bin", "python3.13"))).mode & 0o777;
		expect(mode & 0o111).not.toBe(0);
	});

	it("preserves an existing runtime when the source is missing", async () => {
		const targetDirectory = join(testRoot, "managed", "3.13.12");
		await mkdir(targetDirectory, { recursive: true });
		await writeFile(join(targetDirectory, "python3"), "existing-runtime", "utf8");

		await expect(
			installRuntimeDirectory({
				sourceDirectory: join(testRoot, "vendor", "absent"),
				targetDirectory,
				executablePath: join(targetDirectory, "python3"),
				expectedVersion: fixtureVersion,
			}),
		).rejects.toThrow();

		await expect(readFile(join(targetDirectory, "python3"), "utf8")).resolves.toBe("existing-runtime");
	});
});
