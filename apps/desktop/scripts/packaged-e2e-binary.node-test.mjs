import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	clearLinuxUnpackedPackageType,
	resolvePackagedE2eAppImagePath,
	resolvePackagedE2eBinaryPath,
	stagePackagedE2eAppImage,
} from "./packaged-e2e-binary.mjs";

test("Linux unpacked E2E uses the built AppImage as the updater runtime image", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	const appImage = join(packageRoot, "release", "567-agent-1.2.3.AppImage");
	await mkdir(join(packageRoot, "release"), { recursive: true });
	await writeFile(appImage, "appimage");

	try {
		assert.equal(resolvePackagedE2eAppImagePath(packageRoot, "1.2.3"), appImage);
	} finally {
		await rm(packageRoot, { recursive: true, force: true });
	}
});

test("Linux packaged E2E rejects unsafe or missing AppImage paths", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	try {
		assert.throws(
			() => resolvePackagedE2eAppImagePath(packageRoot, "../escape"),
			/invalid application version/,
		);
		assert.throws(
			() => resolvePackagedE2eAppImagePath(packageRoot, "1.2.3"),
			/AppImage not found/,
		);
	} finally {
		await rm(packageRoot, { recursive: true, force: true });
	}
});

test("Linux packaged E2E stages an isolated AppImage before updater tests", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	const temporaryRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-stage-"));
	const releaseAppImage = join(packageRoot, "release", "567-agent-1.2.3.AppImage");
	await mkdir(join(packageRoot, "release"), { recursive: true });
	await writeFile(releaseAppImage, "release-appimage");

	try {
		const staged = stagePackagedE2eAppImage(packageRoot, "1.2.3", temporaryRoot);
		assert.notEqual(staged.appImagePath, releaseAppImage);
		assert.equal(await readFile(staged.appImagePath, "utf8"), "release-appimage");

		await writeFile(staged.appImagePath, "downloaded-e2e-update");
		assert.equal(await readFile(releaseAppImage, "utf8"), "release-appimage");
	} finally {
		await Promise.all([
			rm(packageRoot, { recursive: true, force: true }),
			rm(temporaryRoot, { recursive: true, force: true }),
		]);
	}
});

test("Windows packaged E2E drives the versioned Electron binary instead of the detached launcher", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	const unpackedRoot = join(packageRoot, "release", "win-unpacked");
	const versionedBinary = join(unpackedRoot, "versions", "1.2.3", "567-Agent.exe");
	await mkdir(join(unpackedRoot, "versions", "1.2.3"), { recursive: true });
	await Promise.all([
		writeFile(join(unpackedRoot, "567-Agent.exe"), "launcher"),
		writeFile(join(unpackedRoot, "current.json"), '{"version":"1.2.3"}\n'),
		writeFile(versionedBinary, "electron"),
	]);

	try {
		assert.equal(resolvePackagedE2eBinaryPath(packageRoot, "win32"), versionedBinary);
	} finally {
		await rm(packageRoot, { recursive: true, force: true });
	}
});

test("macOS packaged E2E launches the renamed application binary", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	const binary = join(packageRoot, "release", "mac-arm64", "567 Agent.app", "Contents", "MacOS", "567 Agent");
	await mkdir(join(packageRoot, "release", "mac-arm64", "567 Agent.app", "Contents", "MacOS"), { recursive: true });
	await writeFile(binary, "electron");

	try {
		assert.equal(resolvePackagedE2eBinaryPath(packageRoot, "darwin"), binary);
	} finally {
		await rm(packageRoot, { recursive: true, force: true });
	}
});

test("Linux packaged E2E launches the kebab-case application binary", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	const binary = join(packageRoot, "release", "linux-unpacked", "567-agent");
	await mkdir(join(packageRoot, "release", "linux-unpacked"), { recursive: true });
	await writeFile(binary, "electron");

	try {
		assert.equal(resolvePackagedE2eBinaryPath(packageRoot, "linux"), binary);
	} finally {
		await rm(packageRoot, { recursive: true, force: true });
	}
});

test("Windows packaged E2E rejects an unsafe version pointer", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	const unpackedRoot = join(packageRoot, "release", "win-unpacked");
	await mkdir(unpackedRoot, { recursive: true });
	await writeFile(join(unpackedRoot, "current.json"), '{"version":"../escape"}\n');

	try {
		assert.throws(() => resolvePackagedE2eBinaryPath(packageRoot, "win32"), /invalid version pointer/);
	} finally {
		await rm(packageRoot, { recursive: true, force: true });
	}
});

test("Linux packaged E2E drops the deb/rpm package-type marker so the AppImage updater is used", async () => {
	const packageRoot = await mkdtemp(join(tmpdir(), "vetta-packaged-e2e-"));
	const resourcesDir = join(packageRoot, "release", "linux-unpacked", "resources");
	const marker = join(resourcesDir, "package-type");
	await mkdir(resourcesDir, { recursive: true });
	await writeFile(marker, "rpm");

	try {
		clearLinuxUnpackedPackageType(packageRoot);
		await assert.rejects(access(marker));
		clearLinuxUnpackedPackageType(packageRoot);
	} finally {
		await rm(packageRoot, { recursive: true, force: true });
	}
});
