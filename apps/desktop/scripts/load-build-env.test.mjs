import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadBuildEnv, resolveBuildEnvMode } from "./load-build-env.mjs";

test("defaults pure Node build scripts to the production env", () => {
	assert.equal(resolveBuildEnvMode({}), "production");
});

test("keeps an explicit build env such as the test release mode", () => {
	assert.equal(
		resolveBuildEnvMode({
			AGENT567_BUILD_ENV: "test",
		}),
		"test",
	);
	assert.equal(
		resolveBuildEnvMode({ AGENT567_BUILD_ENV: "preview", AGENT567_BUILD_ENV: "production" }),
		"preview",
	);
});

test("loads the production file before the generic fallback during packaging", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vetta-build-env-"));
	try {
		await writeFile(join(cwd, ".env.production"), "AGENT567_SPEECH_INPUT_ENABLED=false\n");
		await writeFile(join(cwd, ".env"), "AGENT567_SPEECH_INPUT_ENABLED=true\n");
		const env = {};

		assert.equal(loadBuildEnv({ env, cwd }), "production");
		assert.equal(env.AGENT567_SPEECH_INPUT_ENABLED, "false");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("normalizes canonical build variables to legacy child-process aliases", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "agent567-build-env-"));
	try {
		await writeFile(join(cwd, ".env.test"), "AGENT567_SPEECH_INPUT_ENABLED=false\n");
		const env = { AGENT567_BUILD_ENV: "test" };

		assert.equal(loadBuildEnv({ env, cwd }), "test");
		assert.equal(env.AGENT567_SPEECH_INPUT_ENABLED, "false");
		assert.equal(env.AGENT567_SPEECH_INPUT_ENABLED, "false");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("canonical variables win when old and new names are both present", () => {
	const env = {
		AGENT567_BUILD_ENV: "test",
		AGENT567_BUILD_ENV: "production",
		AGENT567_SPEECH_INPUT_ENABLED: "false",
		AGENT567_SPEECH_INPUT_ENABLED: "true",
	};

	assert.equal(resolveBuildEnvMode(env), "test");
	assert.equal(env.AGENT567_SPEECH_INPUT_ENABLED, "false");
	assert.equal(env.AGENT567_SPEECH_INPUT_ENABLED, "false");
});

test("does not override a command-line value", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "vetta-build-env-"));
	try {
		await writeFile(join(cwd, ".env.production"), "AGENT567_SPEECH_INPUT_ENABLED=false\n");
		const env = {
			AGENT567_SPEECH_INPUT_ENABLED: "true",
		};

		loadBuildEnv({ env, cwd });
		assert.equal(env.AGENT567_SPEECH_INPUT_ENABLED, "true");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
