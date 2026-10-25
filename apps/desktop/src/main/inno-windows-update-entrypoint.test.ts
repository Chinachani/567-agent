import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { InnoWindowsUpdateController } from "./inno-windows-update.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(), spawn: vi.fn() }));

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => {
	Object.defineProperty(process, "platform", originalPlatform);
	vi.unstubAllEnvs();
	vi.clearAllMocks();
});

it("prepares and activates a default installer using the registered root without launcher environment", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent567-entrypoint-"));
	const storeRoot = join(root, "updates");
	const installerPath = join(root, "setup.exe");
	const versionDir = join(storeRoot, "versions", "1.3.3");
	const executable = join(versionDir, "567-Agent.exe");
	const relaunch = vi.fn();
	const quit = vi.fn();
	for (const key of [
		"AGENT567_HOME",
		"AGENT567_WINDOWS_DATA_ROOT",
		"AGENT567_DESKTOP_USER_DATA_DIR",
		"AGENT567_WINDOWS_UPDATE_STORE",
		"AGENT567_UPDATER_CACHE_DIR",
	])
		vi.stubEnv(key, undefined);
	Object.defineProperty(process, "platform", { value: "win32" });
	vi.mocked(execFileSync).mockReturnValue(JSON.stringify("D:\\数据 目录"));
	const args: string[][] = [];

	try {
		await writeFile(installerPath, "synthetic installer");
		// The external installer boundary creates the real files before exiting.
		vi.mocked(spawn).mockImplementationOnce((_command, commandArgs) => {
			args.push([...(commandArgs ?? [])]);
			const child = new EventEmitter();
			void mkdir(join(versionDir, "resources"), { recursive: true })
				.then(() =>
					Promise.all([
						writeFile(executable, "synthetic executable"),
						writeFile(join(versionDir, "resources", "app.asar"), "synthetic asar"),
						writeFile(join(versionDir, ".install-complete"), "1.3.3"),
					]),
				)
				.then(
					() => child.emit("close", 0),
					(error) => child.emit("error", error),
				);
			return child as ReturnType<typeof spawn>;
		});
		const controller = new InnoWindowsUpdateController({ currentVersion: "1.3.2", storeRoot, relaunch, quit });
		controller.select(
			{ version: "1.3.3", files: [], path: "setup.exe", sha512: "synthetic", releaseDate: "2026-10-21" },
			[
				{
					url: new URL("https://example.test/setup.exe"),
					info: { url: "setup.exe", sha512: "synthetic", size: 19 },
				},
			],
		);
		await expect(
			controller.prepareDownloadedInstaller(installerPath, () => {}, new AbortController().signal),
		).resolves.toEqual([executable]);
		expect(args).toHaveLength(1);
		expect(args[0]).toContain("/VETTADATAROOT=D:\\数据 目录");
		expect(args[0]).toContain(`/VETTASTOREROOT=${storeRoot}`);
		await controller.activate();
		expect(JSON.parse(await readFile(join(storeRoot, "current.json"), "utf8"))).toEqual({
			version: "1.3.3",
			previousVersion: "1.3.2",
			pending: true,
		});
		expect(relaunch).toHaveBeenCalledWith(executable);
		expect(quit).toHaveBeenCalledOnce();
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
