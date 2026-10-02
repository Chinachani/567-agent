import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { buildLinuxTargets, mergeLinuxDocuments } from "./linux-target-builds.mjs";

async function withReleaseDir(runTest) {
	const releaseDir = await mkdtemp(join(tmpdir(), "linux-target-builds-"));
	try {
		await runTest(releaseDir);
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
}

test("Linux formats build serially and publish merged updater metadata once", async () => {
	await withReleaseDir(async (releaseDir) => {
		const events = [];
		const published = [];
		const targets = ["AppImage", "deb", "rpm"];
		await buildLinuxTargets({
			targets,
			releaseDir,
			run: async ([target]) => {
				events.push(`start:${target}`);
				const extension = target === "AppImage" ? ".AppImage" : `.${target}`;
				const artifact = `567-agent-1.1.7${extension}`;
				await writeFile(join(releaseDir, artifact), target);
				await writeFile(join(releaseDir, "latest-linux.yml"), [
					"version: 1.1.7",
					`path: ${artifact}`,
					"sha512: digest",
					"files:",
					`  - url: ${artifact}`,
					"    sha512: digest",
					"    size: 12",
				].join("\n"));
				events.push(`end:${target}`);
			},
			publish: async (files) => {
				events.push("publish");
				published.push(...files);
			},
		});

		assert.deepEqual(events, [
			"start:AppImage", "end:AppImage",
			"start:deb", "end:deb",
			"start:rpm", "end:rpm",
			"publish",
		]);
		const metadata = parse(await readFile(join(releaseDir, "latest-linux.yml"), "utf8"));
		assert.deepEqual(metadata.files.map((file) => file.url), [
			"567-agent-1.1.7.AppImage",
			"567-agent-1.1.7.deb",
			"567-agent-1.1.7.rpm",
		]);
		assert.equal(metadata.path, "567-agent-1.1.7.AppImage");
		assert.equal(published.length, 4);
		assert.ok(published.some((file) => file.endsWith("latest-linux.yml")));
		assert.ok((await readdir(releaseDir)).includes("567-agent-1.1.7.rpm"));
	});
});

test("non-updater Linux targets preserve existing metadata", async () => {
	await withReleaseDir(async (releaseDir) => {
		const metadataPath = join(releaseDir, "latest-linux.yml");
		await writeFile(metadataPath, "version: 1.1.7\nfiles: []\n");
		await buildLinuxTargets({
			targets: ["tar.gz"],
			releaseDir,
			run: async () => writeFile(join(releaseDir, "567-agent-1.1.7.tar.gz"), "archive"),
		});
		assert.match(await readFile(metadataPath, "utf8"), /version: 1\.1\.7/);
	});
});

test("Linux metadata merge rejects version and artifact conflicts", () => {
	const doc = (url, sha512 = "digest", version = "1.1.7") => ({
		version,
		files: [{ url, sha512, size: 10 }],
	});
	assert.throws(() => mergeLinuxDocuments([doc("a.AppImage"), doc("b.deb", "digest", "1.1.8")]), /version mismatch/);
	assert.throws(() => mergeLinuxDocuments([doc("same.deb"), doc("same.deb", "other")]), /Conflicting Linux update artifact/);
});
