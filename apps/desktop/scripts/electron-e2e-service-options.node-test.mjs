import assert from "node:assert/strict";
import test from "node:test";
import {
	configureElectronE2eProfile,
	resolveElectronE2eServiceOptions,
	resolveElectronE2eSpecRetryOptions,
} from "./electron-e2e-service-options.mjs";

test("ChromeDriver and Windows Electron use the same fresh profile across worker retries", () => {
	const caps = { "goog:chromeOptions": {
		binary: "D:\\app\\567-Agent.exe",
		args: ["--inspect=1234", "--user-data-dir=D:\\old-profile", "--remote-debugging-port=0"],
	} };
	const environment = { AGENT567_WINDOWS_DATA_ROOT: "D:\\Saved Data" };
	for (const profile of ["D:\\Temp\\wdio-electron-user-data-first", "D:\\Temp\\wdio-electron-user-data-retry"]) {
		configureElectronE2eProfile(caps, profile, environment);
		assert.equal(environment.AGENT567_DESKTOP_USER_DATA_DIR, profile);
		assert.deepEqual(caps["goog:chromeOptions"].args, [
			"--inspect=1234", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
		]);
		assert.equal(environment.AGENT567_WINDOWS_DATA_ROOT, "D:\\Saved Data");
	}
});

test("Linux CI installs a scoped AppArmor profile before launching Electron", () => {
	assert.deepEqual(resolveElectronE2eServiceOptions({ platform: "linux", ci: "true" }), {
		clearMocks: true,
		apparmorAutoInstall: "sudo",
	});
});

test("local and non-Linux E2E runs do not request elevated AppArmor setup", () => {
	assert.deepEqual(resolveElectronE2eServiceOptions({ platform: "linux", ci: "false" }), {
		clearMocks: true,
	});
	assert.deepEqual(resolveElectronE2eServiceOptions({ platform: "win32", ci: "true" }), {
		clearMocks: true,
	});
});

test("packaged E2E retries a failed spec once with a fresh browser instance", () => {
	assert.deepEqual(resolveElectronE2eSpecRetryOptions({ packaged: true }), {
		specFileRetries: 1,
		specFileRetriesDelay: 0,
		specFileRetriesDeferred: false,
	});
	assert.deepEqual(resolveElectronE2eSpecRetryOptions({ packaged: false }), {
		specFileRetries: 0,
		specFileRetriesDelay: 0,
		specFileRetriesDeferred: false,
	});
});
