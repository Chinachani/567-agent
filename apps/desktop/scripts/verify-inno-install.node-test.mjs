import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInnoInstaller } from "./inno-installer-process.mjs";
import { assertDisposableWindowsVerification } from "./verify-inno-install.mjs";

test("ordinary-install verifier refuses local, self-hosted and unapproved profile mutations", () => {
	const approved = { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", AGENT567_VERIFY_WINDOWS_INSTALL: "1" };
	assert.doesNotThrow(() => assertDisposableWindowsVerification(approved, "win32"));
	for (const environment of [
		{}, { ...approved, GITHUB_ACTIONS: "false" }, { ...approved, RUNNER_ENVIRONMENT: "self-hosted" },
		{ ...approved, AGENT567_VERIFY_WINDOWS_INSTALL: "0" },
	]) {
		assert.throws(() => assertDisposableWindowsVerification(environment, "win32"), /disposable/);
	}
	assert.throws(() => assertDisposableWindowsVerification(approved, "linux"), /Windows/);
});

test("installer process reports failure with native UTF-16 diagnostics and accepts success", async () => {
	const root = await mkdtemp(join(tmpdir(), "inno-process-"));
	const logPath = join(root, "install.log");
	try {
		await writeFile(logPath, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Type Mismatch: 迁移失败", "utf16le")]));
		await assert.rejects(runInnoInstaller({
			installerPath: process.execPath, args: ["-e", "process.exit(9)"], logPath,
		}), /exited with code 9.*log follows:\s+Type Mismatch: 迁移失败/s);
		await runInnoInstaller({ installerPath: process.execPath, args: ["-e", "process.exit(0)"], logPath });
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("installer process bounds hangs and surfaces spawn errors", async () => {
	const root = await mkdtemp(join(tmpdir(), "inno-process-"));
	const logPath = join(root, "install.log");
	try {
		await writeFile(logPath, "installer stalled");
		await assert.rejects(runInnoInstaller({
			installerPath: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], logPath, timeoutMs: 100,
		}), /timed out after 100ms.*installer stalled/s);
		await assert.rejects(runInnoInstaller({ installerPath: join(root, "missing.exe"), args: [], logPath }), /ENOENT/);
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("installer process forwards an environment without launcher data variables", async () => {
	const root = await mkdtemp(join(tmpdir(), "inno-env-"));
	const logPath = join(root, "install.log");
	const outputPath = join(root, "environment.json");
	const environment = { ...process.env, AGENT567_INSTALL_TEST_OUTPUT: outputPath };
	const dataVariables = ["AGENT567_HOME", "AGENT567_WINDOWS_DATA_ROOT", "AGENT567_DESKTOP_USER_DATA_DIR", "AGENT567_WINDOWS_UPDATE_STORE", "AGENT567_UPDATER_CACHE_DIR"];
	for (const key of dataVariables) delete environment[key];
	try {
		await runInnoInstaller({
			installerPath: process.execPath,
			args: ["-e", "require('node:fs').writeFileSync(process.env.AGENT567_INSTALL_TEST_OUTPUT, JSON.stringify(process.env))"],
			logPath,
			environment,
		});
		const actual = JSON.parse(await readFile(outputPath, "utf8"));
		assert.equal(actual.AGENT567_INSTALL_TEST_OUTPUT, outputPath);
		for (const key of dataVariables) assert.equal(actual[key], undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
