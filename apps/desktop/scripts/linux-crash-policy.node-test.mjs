import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
	APPORT_POLICY_PATH,
	LINUX_EXECUTABLE_PATH,
	stageLinuxCrashPolicy,
	verifyLinuxCrashPolicy,
} from "./linux-crash-policy.mjs";
import { readPackagedCrashPolicy } from "./verify-linux-packages.mjs";

test("staged policy has one exact executable and is wired to both FPM formats", async () => {
	const dir = await mkdtemp(join(tmpdir(), "567-apport-"));
	try {
		const [mapping] = await stageLinuxCrashPolicy(dir);
		const [source, destination] = mapping.split("=");
		assert.equal(destination, APPORT_POLICY_PATH);
		const body = await readFile(source, "utf8");
		verifyLinuxCrashPolicy(body);
		assert.throws(() => verifyLinuxCrashPolicy(`${body}/usr/bin/another-app\n`));
		assert.throws(() => verifyLinuxCrashPolicy("/opt/*\n"));
		assert.throws(() => verifyLinuxCrashPolicy(""));
		const pack = await readFile(new URL("prepare-pack.js", import.meta.url), "utf8");
		assert.match(pack, /rpm: \{ fpm: linuxCrashPolicyFpm \}/);
		assert.match(pack, /deb: \{\s*fpm: linuxCrashPolicyFpm,/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test(
	"DEB carries the generated policy and the production inspector reads it back",
	{ skip: process.platform !== "linux" },
	async () => {
		const dir = await mkdtemp(join(tmpdir(), "567-apport-deb-"));
		try {
			const [mapping] = await stageLinuxCrashPolicy(dir);
			const root = join(dir, "package");
			await mkdir(join(root, "DEBIAN"), { recursive: true });
			await writeFile(
				join(root, "DEBIAN/control"),
				"Package: agent567-crash-policy-fixture\nVersion: 1.0.0\nArchitecture: all\nMaintainer: Test <test@example.invalid>\nDescription: isolated policy fixture\n",
			);
			const path = join(root, APPORT_POLICY_PATH);
			await mkdir(dirname(path), { recursive: true });
			await copyFile(mapping.split("=")[0], path);
			const archive = join(dir, "fixture.deb");
			execFileSync("dpkg-deb", ["--build", "--root-owner-group", root, archive], { stdio: "pipe" });
			const body = await readPackagedCrashPolicy("deb", archive);
			verifyLinuxCrashPolicy(body);
			assert.ok(body.includes(LINUX_EXECUTABLE_PATH));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
);
