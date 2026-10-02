import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	parseDebContents,
	parseDebFields,
	parseRpmFields,
	readExpectedVersion,
	verifyLinuxPackageInspection,
} from "./verify-linux-packages.mjs";

const paths = [
	"/opt/567-agent/567-agent",
	"/opt/567-agent/resources/package-type",
	"/usr/share/applications/567-agent.desktop",
	"/usr/share/icons/hicolor/512x512/apps/567-agent.png",
];

test("Linux package inspection accepts matching Debian and RPM packages", () => {
	assert.doesNotThrow(() =>
		verifyLinuxPackageInspection({
			expectedVersion: "1.2.3",
			deb: { name: "567-agent", version: "1.2.3", arch: "amd64", paths },
			rpm: { name: "567-agent", version: "1.2.3", arch: "x86_64", paths },
		}),
	);
});

test("Linux package inspection rejects wrong identities and incomplete payloads", () => {
	assert.throws(
		() =>
			verifyLinuxPackageInspection({
				expectedVersion: "1.2.3",
				deb: { name: "567-agent", version: "1.2.2", arch: "amd64", paths },
				rpm: { name: "567-agent", version: "1.2.3", arch: "x86_64", paths },
			}),
		/Debian version 1\.2\.2 does not match 1\.2\.3/,
	);
	assert.throws(
		() =>
			verifyLinuxPackageInspection({
				expectedVersion: "1.2.3",
				deb: { name: "567-agent", version: "1.2.3", arch: "amd64", paths },
				rpm: { name: "567-agent", version: "1.2.3", arch: "x86_64", paths: paths.slice(1) },
			}),
		/RPM package is missing \/opt\/567-agent\/567-agent/,
	);
});

test("package command output parsers normalize Debian and RPM metadata", () => {
	assert.deepEqual(
		parseDebFields("Package: 567-agent\nVersion: 1.2.3\nArchitecture: amd64\nDescription: 567 Agent\n"),
		{ name: "567-agent", version: "1.2.3", arch: "amd64" },
	);
	assert.deepEqual(parseRpmFields("567-agent\n1.2.3\nx86_64\n"), {
		name: "567-agent",
		version: "1.2.3",
		arch: "x86_64",
	});
	assert.deepEqual(
		parseDebContents(
			"-rwxr-xr-x root/root 123 2026-01-01 00:00 ./opt/567-agent/567-agent\n" +
				"lrwxrwxrwx root/root 0 2026-01-01 00:00 ./usr/bin/567-agent -> /opt/567-agent/567-agent\n",
		),
		["/opt/567-agent/567-agent", "/usr/bin/567-agent"],
	);
});

test("native package verification uses the release manifest version", async () => {
	const releaseDir = await mkdtemp(join(tmpdir(), "vetta-linux-packages-"));
	try {
		await writeFile(join(releaseDir, "latest-linux.yml"), "version: 9.8.7\n");
		assert.equal(await readExpectedVersion(releaseDir), "9.8.7");
	} finally {
		await rm(releaseDir, { recursive: true, force: true });
	}
});
