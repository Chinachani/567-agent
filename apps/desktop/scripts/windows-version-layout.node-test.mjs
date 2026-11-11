import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import windowsVersionLayout, { buildWindowsLauncher, createWindowsVersionLayout, editAndSignWindowsLauncher, validateLayoutVersion } from "./windows-version-layout.mjs";

test("createWindowsVersionLayout keeps launcher, pointer, and NSIS compatibility directory at root", async () => {
	const directory = await mkdtemp(join(tmpdir(), "vetta-version-layout-"));
	await mkdir(join(directory, "resources"), { recursive: true });
	await writeFile(join(directory, "567-Agent.exe"), "electron");
	await writeFile(join(directory, "resources", "app.asar"), "asar");
	const launcherPath = join(directory, "VettaLauncher.exe");
	await writeFile(launcherPath, "launcher");

	await createWindowsVersionLayout(directory, "1.2.3", launcherPath);

	assert.equal(await readFile(join(directory, "567-Agent.exe"), "utf8"), "launcher");
	assert.equal(await readFile(join(directory, "versions", "1.2.3", "567-Agent.exe"), "utf8"), "electron");
	assert.equal((await stat(join(directory, "resources"))).isDirectory(), true);
	assert.deepEqual(JSON.parse(await readFile(join(directory, "current.json"), "utf8")), { version: "1.2.3" });
});

test("a new local Go build cannot be replaced by electron-builder's signed executable cache", async () => {
	const require = createRequire(import.meta.url);
	const builderRequire = createRequire(require.resolve("electron-builder"));
	const libraryRequire = createRequire(builderRequire.resolve("app-builder-lib"));
	builderRequire("app-builder-lib");
	const { WinPackager } = libraryRequire("./winPackager.js");
	const ci = libraryRequire("ci-info");
	const originalCI = ci.isCI;
	const originalCache = process.env.ELECTRON_BUILDER_DISABLE_BUILD_CACHE;
	const directory = await mkdtemp(join(tmpdir(), "agent567-launcher-cache-"));
	const sourceDir = join(directory, "go");
	const launcherPath = join(directory, "launcher.exe");
	let signings = 0;
	try {
		ci.isCI = false;
		process.env.ELECTRON_BUILDER_DISABLE_BUILD_CACHE = "0";
		await mkdir(sourceDir);
		await writeFile(join(sourceDir, "data_root_windows.go"), "package main\n");
		const build = async (marker) => {
			await writeFile(join(sourceDir, "main.go"), `package main\nimport "fmt"\nfunc main() { fmt.Println("${marker}") }\n`);
			buildWindowsLauncher({ arch: "x64", outputPath: launcherPath, sourceDir });
		};
		const packager = {
			appInfo: { productName: "567 Agent", copyright: "fixture", shortVersion: "1.5.8", shortVersionWindows: "1.5.8" },
			config: { electronVersion: "35.0.0" },
			platformSpecificBuildOptions: {},
			signingManager: { value: Promise.resolve({ cscInfo: { value: Promise.resolve({}) } }) },
			getIconPath: async () => fileURLToPath(new URL("../build/icon.ico", import.meta.url)),
			getResourcesDir: () => join(directory, "resources"),
			signIf: async () => { signings++; },
			signAndEditResources: WinPackager.prototype.signAndEditResources,
		};
		await build("cache-fixture-previous-launcher");
		await packager.signAndEditResources(launcherPath, 1, directory, "567-Agent");
		await build("cache-fixture-fresh-launcher");
		await editAndSignWindowsLauncher({ packager, arch: 1, outDir: directory }, launcherPath);
		assert.equal(signings, 2);
		const binary = await readFile(launcherPath);
		assert.ok(binary.includes(Buffer.from("cache-fixture-fresh-launcher")));
		assert.ok(!binary.includes(Buffer.from("cache-fixture-previous-launcher")));
		assert.equal(process.env.ELECTRON_BUILDER_DISABLE_BUILD_CACHE, "0");
		packager.signAndEditResources = async () => { throw new Error("signing unavailable"); };
		await assert.rejects(editAndSignWindowsLauncher({ packager, arch: 1, outDir: directory }, launcherPath), /signing unavailable/);
		assert.equal(process.env.ELECTRON_BUILDER_DISABLE_BUILD_CACHE, "0");
	} finally {
		ci.isCI = originalCI;
		if (originalCache === undefined) delete process.env.ELECTRON_BUILDER_DISABLE_BUILD_CACHE;
		else process.env.ELECTRON_BUILDER_DISABLE_BUILD_CACHE = originalCache;
		await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});

test("validateLayoutVersion rejects path traversal", () => {
	assert.throws(() => validateLayoutVersion("../1.2.3"), /invalid version/);
	assert.equal(validateLayoutVersion("1.2.3-beta.1"), "1.2.3-beta.1");
});

test("the packaged Go bootstrapper carries every branded icon size, independently of Electron", async () => {
	const require = createRequire(import.meta.url);
	const builderRequire = createRequire(require.resolve("electron-builder"));
	const libraryRequire = createRequire(builderRequire.resolve("app-builder-lib"));
	const { editWindowsResources } = libraryRequire("./util/resEdit.js");
	const { NtExecutable, NtExecutableResource, Resource, Data } = libraryRequire("resedit");
	const directory = await mkdtemp(join(tmpdir(), "agent567-branded-launcher-"));
	const iconPath = new URL("../build/icon.ico", import.meta.url);
	try {
		await mkdir(join(directory, "resources"));
		await writeFile(join(directory, "567-Agent.exe"), "electron fixture");
		await windowsVersionLayout({
			electronPlatformName: "win32",
			arch: 1,
			appOutDir: directory,
			outDir: directory,
			packager: {
				appInfo: { version: "1.5.8" },
				async signAndEditResources(file) {
					await editWindowsResources({
						file,
						iconPath,
						versionStrings: { ProductName: "567 Agent" },
						fileVersion: "1.5.8",
						productVersion: "1.5.8",
					});
				},
			},
		});
		const binary = NtExecutable.from(await readFile(join(directory, "567-Agent.exe")));
		const resources = NtExecutableResource.from(binary);
		const group = Resource.IconGroupEntry.fromEntries(resources.entries)[0];
		assert.ok(group, "bootstrapper must contain an icon group");
		const actual = group.getIconItemsFromEntries(resources.entries);
		const expected = Data.IconFile.from(await readFile(iconPath)).icons;
		assert.equal(actual.length, expected.length);
		const iconBytes = (icon) => Buffer.from(icon.isRaw() ? icon.bin : icon.generate());
		assert.deepEqual(
			actual.map(iconBytes),
			expected.map((icon) => iconBytes(icon.data)),
		);
		assert.equal(
			Resource.VersionInfo.fromEntries(resources.entries)[0].getStringValues({ lang: 1033, codepage: 1200 })
				.ProductName,
			"567 Agent",
		);
	} finally {
		await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
	}
});
