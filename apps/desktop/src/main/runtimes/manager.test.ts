import * as childProcess from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeManager } from "./manager";
import { executablePathFor, installDir, platformEntry, registryPath, runtimeVersion, vendorRuntimeDir } from "./paths";
import { nodePackageManagerPaths } from "./runtime-health";
import { writeNodeRuntimeFixture } from "./runtime-test-fixtures";

vi.mock("../logger.js", () => ({ getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../i18n/index.js", () => ({ mainT: (key: string) => key }));
vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof childProcess>();
	return { ...actual, spawnSync: vi.fn(actual.spawnSync) };
});
const actualChildProcess = await vi.importActual<typeof childProcess>("node:child_process");
let root = "";
let resourcesDescriptor: PropertyDescriptor | undefined;

beforeEach(async () => {
	vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("test network unavailable")));
	root = await mkdtemp(join(tmpdir(), "567-runtime-manager-"));
	for (const key of [
		"PATH",
		"Path",
		"npm_config_userconfig",
		"NPM_CONFIG_USERCONFIG",
		"npm_config_registry",
		"npm_config_prefix",
		"npm_config_cache",
		"PIP_CONFIG_FILE",
		"PIP_INDEX_URL",
		"PIP_TRUSTED_HOST",
		"PIP_CACHE_DIR",
		"AGENT567_MANAGED_PYTHON_SITE_PACKAGES",
		"AGENT567_MANAGED_PYTHON_SCRIPTS",
	])
		vi.stubEnv(key, process.env[key]);
	vi.stubEnv("AGENT567_CODING_AGENT_DIR", join(root, "agent"));
	resourcesDescriptor = Object.getOwnPropertyDescriptor(process, "resourcesPath");
	Object.defineProperty(process, "resourcesPath", { configurable: true, value: join(root, "resources") });
	// The test runner's Node may be newer than the pinned portable runtime. Keep
	// real npm execution; only substitute the executable's OS version response.
	vi.mocked(childProcess.spawnSync).mockImplementation((command, args, options) => {
		const result = actualChildProcess.spawnSync(command, args, options);
		if (command.startsWith(root) && args?.[0] === "--version" && result.status === 0) {
			return { ...result, stdout: `v${runtimeVersion("node")}\n` };
		}
		return result;
	});
});

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.mocked(childProcess.spawnSync).mockImplementation(actualChildProcess.spawnSync);
	vi.unstubAllEnvs();
	if (resourcesDescriptor) Object.defineProperty(process, "resourcesPath", resourcesDescriptor);
	else Reflect.deleteProperty(process, "resourcesPath");
	await rm(root, { recursive: true, force: true });
});

describe("RuntimeManager Node recovery", () => {
	it("uses the locale translation for download progress before reporting a corrupt archive", async () => {
		vi.mocked(fetch).mockResolvedValue(new Response("not an archive", { headers: { "content-length": "14" } }));
		const manager = new RuntimeManager();
		const messages: string[] = [];
		await expect(
			manager.reinstall("node", (event) => {
				if (event.phase === "downloading") messages.push(event.message);
			}),
		).rejects.toThrow();
		expect(messages.length).toBeGreaterThan(0);
		expect(new Set(messages)).toEqual(new Set(["runtimes.downloading"]));
	});

	it("prepares and registers an already installed runtime without requiring a vendor package", async () => {
		await writeNodeRuntimeFixture(installDir("node"));
		const manager = new RuntimeManager();
		const statuses: boolean[] = [];
		manager.onStatusChanged(() => {
			throw new Error("closed settings view");
		});
		const unsubscribe = manager.onStatusChanged(() => statuses.push(manager.getStatus().node.ready));
		await manager.initialize();
		expect(manager.getStatus().node.ready).toBe(true);
		expect(JSON.parse(await readFile(registryPath(), "utf8")).binaries.node.verified).toBe(true);
		expect(statuses).toContain(true);
		unsubscribe();
		const count = statuses.length;
		manager.scheduleRepair("node");
		expect(statuses).toHaveLength(count);
	});
	it("defers executable probes until after the initial environment setup", async () => {
		await writeNodeRuntimeFixture(installDir("node"));
		const manager = new RuntimeManager();
		vi.mocked(childProcess.spawnSync).mockClear();
		manager.applyEnv("available");
		expect(childProcess.spawnSync).not.toHaveBeenCalled();
		await manager.ensureReady("node");
		expect(childProcess.spawnSync).toHaveBeenCalled();
	});

	it("persists restart repair intent and clears it only after restoration succeeds", async () => {
		await writeNodeRuntimeFixture(installDir("node"));
		await writeNodeRuntimeFixture(vendorRuntimeDir("node"));
		await writeFile(join(installDir("node"), "old-marker"), "old");
		new RuntimeManager().scheduleRepair("node");
		const restarted = new RuntimeManager();
		expect(restarted.getStatus().node.repairRequiresRestart).toBe(true);
		await restarted.initialize();
		expect(restarted.getStatus().node).toMatchObject({ ready: true, repairRequiresRestart: false });
		await expect(readFile(join(installDir("node"), "old-marker"))).rejects.toThrow();
		expect(JSON.parse(await readFile(registryPath(), "utf8")).pendingRepairs).toEqual([]);
	});

	it("keeps a scheduled repair available after a failed startup repair", async () => {
		const executable = await writeNodeRuntimeFixture(vendorRuntimeDir("node"));
		await rm(nodePackageManagerPaths(executable).npmCli);
		new RuntimeManager().scheduleRepair("node");
		const restarted = new RuntimeManager();
		await restarted.initialize();
		expect(restarted.getStatus().node).toMatchObject({ ready: false, repairRequiresRestart: true });
		expect(JSON.parse(await readFile(registryPath(), "utf8")).pendingRepairs).toEqual(["node"]);
	});

	it("shares on-demand recovery with app initialization", async () => {
		await writeNodeRuntimeFixture(vendorRuntimeDir("node"));
		const manager = new RuntimeManager();
		const first = manager.ensureReady("node");
		const second = manager.ensureReady("node");
		expect(first).toBe(second);
		await Promise.all([first, manager.initialize()]);
		expect(manager.getStatus().node.ready).toBe(true);
	});
	it("does not return a cached ready state after npm disappears", async () => {
		await writeNodeRuntimeFixture(installDir("node"));
		const manager = new RuntimeManager();
		expect(manager.getStatus().node.ready).toBe(true);
		await rm(nodePackageManagerPaths(executablePathFor("node")).npmCli);
		expect(manager.getStatus().node.ready).toBe(false);
		expect(() => manager.getExecutable("node")).toThrow("not ready");
	});

	it("repairs a partial Node installation from the bundle on app startup", async () => {
		await writeNodeRuntimeFixture(installDir("node"));
		const npmCli = nodePackageManagerPaths(executablePathFor("node")).npmCli;
		await rm(npmCli);
		await writeFile(join(installDir("node"), ".vendor-version"), runtimeVersion("node"));
		await writeNodeRuntimeFixture(vendorRuntimeDir("node"));
		const manager = new RuntimeManager();
		expect(manager.getStatus().node.ready).toBe(false);
		await manager.initialize();
		expect(manager.getStatus().node.ready).toBe(true);
		await expect(readFile(npmCli, "utf8")).resolves.toContain("require");
		expect(manager.getExecutable("node")).toBe(executablePathFor("node"));
	});

	it("preserves the old installation and its marker if the bundled repair is incomplete", async () => {
		await writeNodeRuntimeFixture(installDir("node"));
		await writeFile(join(installDir("node"), ".vendor-version"), runtimeVersion("node"));
		const sourceExecutable = await writeNodeRuntimeFixture(vendorRuntimeDir("node"));
		await rm(nodePackageManagerPaths(sourceExecutable).npmCli);
		const manager = new RuntimeManager();
		await expect(manager.reinstall("node")).rejects.toThrow("npm-cli.js");
		expect(fetch).toHaveBeenCalled();
		expect(manager.getStatus().node.ready).toBe(true);
		await expect(readFile(join(installDir("node"), ".vendor-version"), "utf8")).resolves.toBe(runtimeVersion("node"));
	});

	it("shares a repair requested twice and makes npm usable again", async () => {
		expect(platformEntry("node")).toBeDefined();
		await mkdir(installDir("node"), { recursive: true });
		await writeNodeRuntimeFixture(vendorRuntimeDir("node"));
		const manager = new RuntimeManager();
		const first = manager.reinstall("node");
		const second = manager.reinstall("node");
		expect(second).toBe(first);
		await expect(first).resolves.toMatchObject({ ready: true });
		expect(manager.getStatus().node.ready).toBe(true);
	});
});
