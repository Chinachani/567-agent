import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { stringify } from "yaml";
import { resolveInnoCompiler, writeInnoVerificationManifest } from "./build-inno-installer.mjs";
import { runInnoInstaller } from "./inno-installer-process.mjs";
import { readExpectedWindowsVersion, verifyExtractedWindowsLayout } from "./verify-windows-packages.mjs";

const execFileAsync = promisify(execFile);
const desktopRoot = resolve(import.meta.dirname, "..");
const releaseDir = join(desktopRoot, "release");
const registryKeys = [
	"Software\\567Agent",
	"Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{A2B92798-AB76-4F6B-A9B9-C252DBCB617C}_is1",
	...[
		".567plugin", ".vettapkg", "567Agent.PluginPackage", ".567design",
		"567Agent.DesignShare", "agent567", "vetta",
	].map((name) => `Software\\Classes\\${name}`),
];
const silentArguments = [
	"/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/NOCLOSEAPPLICATIONS",
	"/NORESTARTAPPLICATIONS", "/SP-", "/NOICONS", "/TASKS=",
];

async function powershell(script) {
	const command = [
		"$ErrorActionPreference = 'Stop'",
		"[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)",
		script,
	].join("; ");
	const { stdout } = await execFileAsync("powershell.exe", [
		"-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(command, "utf16le").toString("base64"),
	], { timeout: 30_000 });
	return stdout.trim();
}

async function registryState() {
	return JSON.parse(await powershell(`
		$state = @{}
		foreach ($path in @(${registryKeys.map((key) => `'${key}'`).join(",")})) {
			$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($path)
			try {
				$state[$path] = @{ exists = ($null -ne $key); dataRoot = $null }
				if ($key) { $state[$path].dataRoot = $key.GetValue('DataRoot') }
			} finally { if ($key) { $key.Dispose() } }
		}
		ConvertTo-Json -InputObject $state -Compress
	`));
}

async function removeOwnedRegistryKeys() {
	await powershell(`
		foreach ($path in @(${registryKeys.map((key) => `'${key}'`).join(",")})) {
			[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($path, $false)
		}
	`);
}

async function exists(path) {
	return stat(path).then(() => true, (error) => {
		if (error.code === "ENOENT") return false;
		throw error;
	});
}

async function seedFiles(root, files) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(resolve(root, path, ".."), { recursive: true });
		await writeFile(join(root, path), content);
	}
}

async function assertFiles(root, files) {
	for (const [path, content] of Object.entries(files)) {
		assert.equal(await readFile(join(root, path), "utf8"), content, `Data changed or missing: ${join(root, path)}`);
	}
}

export function assertDisposableWindowsVerification(environment = process.env, platform = process.platform) {
	if (platform !== "win32" || environment.GITHUB_ACTIONS !== "true" ||
		environment.RUNNER_ENVIRONMENT !== "github-hosted" || environment.AGENT567_VERIFY_WINDOWS_INSTALL !== "1") {
		throw new Error("Ordinary-install verification requires an explicitly opted-in disposable GitHub-hosted Windows runner.");
	}
}

/** Runs the production ordinary-install path, including its real HKCU/profile migration.
 * Refuse any existing state and require an explicitly opted-in disposable hosted runner. */
export async function verifyInnoInstall({ installerPath, version, diagnosticsDir }) {
	assertDisposableWindowsVerification();
	const folders = JSON.parse(await powershell(`
		@{ profile = $env:USERPROFILE;
		   roaming = [Environment]::GetFolderPath('ApplicationData');
		   local = [Environment]::GetFolderPath('LocalApplicationData') } | ConvertTo-Json -Compress
	`));
	for (const name of ["profile", "roaming", "local"]) {
		if (!folders[name]) throw new Error(`Windows profile folder unavailable: ${name}`);
	}
	const defaultData = join(folders.profile, ".567agent");
	const legacyData = join(folders.profile, ".vetta");
	const oldElectron = join(folders.roaming, "567-agent");
	const oldUpdates = join(folders.local, "567Agent");
	const oldCache = join(folders.local, "567-agent-updater");
	const ownedProfilePaths = [defaultData, legacyData, oldElectron, oldUpdates, oldCache];
	const migrationSiblings = async () => (await readdir(folders.profile))
		.filter((name) => name.startsWith(".567agent.migrating-"))
		.map((name) => join(folders.profile, name));
	const state = await registryState();
	for (const [key, value] of Object.entries(state)) {
		if (value.exists) throw new Error(`Refusing to replace existing installer registry state: HKCU\\${key}`);
	}
	for (const path of [...ownedProfilePaths, ...await migrationSiblings()]) {
		if (await exists(path)) throw new Error(`Refusing to touch existing application data: ${path}`);
	}
	const secondVolume = process.env.RUNNER_TEMP;
	if (!secondVolume || parse(secondVolume).root.toLowerCase() === parse(folders.local).root.toLowerCase()) {
		throw new Error("A separate runner temporary volume is required to verify migration off the system drive.");
	}
	await mkdir(diagnosticsDir, { recursive: true });
	const sandbox = await mkdtemp(join(folders.local, "I-"));
	const movedSandbox = await mkdtemp(join(secondVolume, "I-data-")).catch(async (error) => {
		await rm(sandbox, { recursive: true, force: true });
		throw error;
	});
	const appRoot = join(sandbox, "app");
	const customData = join(movedSandbox, "数据 目录");
	const occupiedData = join(sandbox, "occupied");
	const cases = [];
	const runCase = async (name, action) => {
		const result = { name, status: "running" };
		cases.push(result);
		console.log(`[verify-inno-install] ${name}`);
		try { await action(); result.status = "passed"; }
		catch (error) { result.status = "failed"; result.error = error.message; throw error; }
		finally {
			await writeFile(join(diagnosticsDir, "results.json"), JSON.stringify({
				version, dataVolumes: { source: parse(defaultData).root, destination: parse(customData).root }, cases,
			}, null, 2));
		}
	};
	const install = async (name, dataRoot) => {
		await runInnoInstaller({
			installerPath,
			args: [...silentArguments, `/DIR=${appRoot}`, ...(dataRoot ? [`/VETTADATAROOT=${dataRoot}`] : [])],
			logPath: join(diagnosticsDir, `${name}.log`),
		});
	};
	const assertRoot = async (path) => {
		assert.equal((await registryState())[registryKeys[0]].dataRoot.toLowerCase(), path.toLowerCase());
		assert.equal(await readFile(join(path, ".data-migration-complete"), "utf8"), "1");
		assert.equal(await verifyExtractedWindowsLayout(appRoot, version), appRoot);
	};
	const uninstall = async (name) => {
		const uninstallerPath = join(appRoot, "unins000.exe");
		if (await exists(uninstallerPath)) {
			await runInnoInstaller({
				installerPath: uninstallerPath, args: silentArguments,
				logPath: join(diagnosticsDir, `${name}-uninstall.log`),
			});
		}
	};
	const clearOwnedState = async () => {
		await removeOwnedRegistryKeys();
		for (const path of [...ownedProfilePaths, ...await migrationSiblings()]) {
			await rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
		}
	};
	let primaryError;
	try {
		await runCase("fresh-default-install", async () => {
			await install("fresh-default-install");
			await assertRoot(defaultData);
		});
		await uninstall("fresh-default-install");
		await clearOwnedState();

		const legacyFiles = {
			"sessions/会话.jsonl": "original conversation\n",
			"credentials.json": "fixture credential, not a real secret",
			"skills/example/SKILL.md": "# Example skill",
			"knowledge/知识.md": "知识库内容",
			"deleted-after-migration.txt": "must not reappear",
		};
		const electronFiles = { "Preferences": '{"fixture":"profile"}' };
		const updateFiles = { "versions/old/retained.txt": "old updater payload" };
		const cacheFiles = { "retained.txt": "old updater cache" };
		await seedFiles(legacyData, legacyFiles);
		await seedFiles(oldElectron, electronFiles);
		await seedFiles(oldUpdates, updateFiles);
		await seedFiles(oldCache, cacheFiles);
		await runCase("legacy-profile-migration", async () => {
			await install("legacy-profile-migration");
			await assertRoot(defaultData);
			await assertFiles(defaultData, legacyFiles);
			await assertFiles(join(defaultData, "electron-user-data"), electronFiles);
			await assertFiles(join(defaultData, "windows-updates"), updateFiles);
			await assertFiles(join(defaultData, "updater-cache/567-agent-updater"), cacheFiles);
			await assertFiles(legacyData, legacyFiles);
			await assertFiles(oldElectron, electronFiles);
			await assertFiles(oldUpdates, updateFiles);
			await assertFiles(oldCache, cacheFiles);
		});
		const currentFiles = { ...legacyFiles, "sessions/会话.jsonl": "edited after migration\n" };
		delete currentFiles["deleted-after-migration.txt"];
		await writeFile(join(defaultData, "sessions/会话.jsonl"), currentFiles["sessions/会话.jsonl"]);
		await rm(join(defaultData, "deleted-after-migration.txt"));
		await runCase("reinstall-keeps-active-data", async () => {
			await install("reinstall-keeps-active-data");
			await assertRoot(defaultData);
			await assertFiles(defaultData, currentFiles);
			assert.equal(await exists(join(defaultData, "deleted-after-migration.txt")), false);
		});
		await runCase("move-to-unicode-data-folder", async () => {
			await install("move-to-unicode-data-folder", customData);
			await assertRoot(customData);
			await assertFiles(customData, currentFiles);
			await assertFiles(defaultData, currentFiles);
			await assertFiles(join(customData, "electron-user-data"), electronFiles);
			await assertFiles(join(customData, "windows-updates"), updateFiles);
			await assertFiles(join(customData, "updater-cache/567-agent-updater"), cacheFiles);
			assert.equal(await exists(join(customData, "deleted-after-migration.txt")), false);
		});
		await runCase("reject-nonempty-destination", async () => {
			await seedFiles(occupiedData, { "keep.txt": "must not be overwritten" });
			await assert.rejects(install("reject-nonempty-destination", occupiedData), /destination contains data|目标文件夹已有数据/i);
			await assertRoot(customData);
			await assertFiles(customData, currentFiles);
			await assertFiles(occupiedData, { "keep.txt": "must not be overwritten" });
		});
		await runCase("reinstall-remembers-custom-folder", async () => {
			await install("reinstall-remembers-custom-folder");
			await assertRoot(customData);
			await assertFiles(customData, currentFiles);
		});
		await uninstall("custom-folder");
		await clearOwnedState();
		await runCase("existing-current-profile-is-authoritative", async () => {
			await seedFiles(defaultData, { "sessions/会话.jsonl": "current profile before registration" });
			await seedFiles(legacyData, { "sessions/会话.jsonl": "stale legacy profile" });
			await install("existing-current-profile-is-authoritative");
			await assertRoot(defaultData);
			await assertFiles(defaultData, { "sessions/会话.jsonl": "current profile before registration" });
			await assertFiles(legacyData, { "sessions/会话.jsonl": "stale legacy profile" });
			const backups = (await migrationSiblings()).filter((path) => path.endsWith(".original"));
			assert.equal(backups.length, 1, "Original current data must be retained in one backup directory");
			await assertFiles(backups[0], { "sessions/会话.jsonl": "current profile before registration" });
		});
		console.log(`[verify-inno-install] ${cases.length} native ordinary-install/migration cases passed: ${version}`);
	} catch (error) {
		primaryError = error;
		throw error;
	} finally {
		try {
			await uninstall("cleanup");
			await clearOwnedState();
			await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
			await rm(movedSandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
		} catch (error) {
			if (!primaryError) throw error;
			console.error(`[verify-inno-install] cleanup failed: ${error.message}`);
		}
	}
}

async function buildFixture(version) {
	const source = await mkdtemp(join(tmpdir(), "inno-source-"));
	const output = join(releaseDir, "inno-native-fixture");
	await mkdir(output, { recursive: true });
	try {
		const versionDir = join(source, "versions", version);
		await seedFiles(source, {
			"567-Agent.exe": "fixture launcher; never executed",
			"current.json": JSON.stringify({ version }),
			[`versions/${version}/567-Agent.exe`]: "fixture Electron; never executed",
			[`versions/${version}/resources/app.asar`]: "fixture application payload",
		});
		await mkdir(join(versionDir, "resources/build"), { recursive: true });
		await copyFile(join(desktopRoot, "build/icon.ico"), join(versionDir, "resources/build/icon.ico"));
		await execFileAsync(resolveInnoCompiler(), [
			"/Qp", `/DAppVersion=${version}`, `/DSourceDir=${source}`, `/DOutputDir=${output}`, "/DArch=x64",
			join(desktopRoot, "build/installer.iss"),
		], { timeout: 120_000 });
		const fileName = `567-Agent-${version}-win-x64.exe`;
		await writeInnoVerificationManifest(versionDir, join(output, `${fileName}.files.json`), version);
		await writeFile(join(output, "latest.yml"), stringify({ version, path: fileName }));
		return { installerPath: join(output, fileName), version };
	} finally { await rm(source, { recursive: true, force: true }); }
}

export async function main() {
	assertDisposableWindowsVerification();
	const fixture = process.argv.includes("--fixture");
	const version = fixture
		? JSON.parse(await readFile(join(desktopRoot, "package.json"), "utf8")).version
		: await readExpectedWindowsVersion(releaseDir);
	const options = fixture ? await buildFixture(version) : {
		installerPath: join(releaseDir, `567-Agent-${version}-win-x64.exe`), version,
	};
	await verifyInnoInstall({ ...options, diagnosticsDir: join(releaseDir, "installer-verification") });
	// The actual release workflow separately runs the background-update verifier.
	if (fixture) {
		const { verifyInnoUpdate: verify } = await import("./verify-inno-update.mjs");
		await verify({ ...options, localAppData: process.env.LOCALAPPDATA,
			verificationManifestPath: `${options.installerPath}.files.json` });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => { console.error(error); process.exitCode = 1; });
}
