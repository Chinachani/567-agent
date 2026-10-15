import type { EventEmitter as EventEmitterType } from "node:events";
import type { PassThrough as PassThroughType } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetQuitCleanupForTest, runQuitCleanup } from "../quit-cleanup.js";
import { prepareCommandRuntime, spawnCrossPlatformCommand } from "./command-launcher.js";
import { runPluginCommand } from "./command-runner.js";
import { spawnPluginCommand } from "./command-spawner.js";

const pluginState = vi.hoisted(() => ({
	trustLevel: "local" as "community" | "local" | "official",
	grantedPermissions: ["agent.command.run", "agent.command.spawn"],
}));

vi.mock("electron", () => ({ webContents: { getAllWebContents: () => [] } }));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: () => undefined, warn: () => undefined }),
}));
vi.mock("./command-launcher.js", async () => {
	const { EventEmitter } = await import("node:events");
	const { PassThrough } = await import("node:stream");
	return {
		prepareCommandRuntime: vi.fn(async () => undefined),
		spawnCrossPlatformCommand: vi.fn(() => {
			const child = new EventEmitter() as EventEmitterType & {
				pid: number;
				stdout: PassThroughType;
				stderr: PassThroughType;
				kill: ReturnType<typeof vi.fn>;
			};
			child.pid = 42;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			child.kill = vi.fn();
			queueMicrotask(() => {
				child.emit("spawn");
				child.emit("exit", 0, null);
				child.emit("close", 0, null);
			});
			return child;
		}),
	};
});
vi.mock("./plugin-catalog.js", () => ({
	listPlugins: () => [
		{
			id: "command-test",
			enabled: true,
			trustLevel: pluginState.trustLevel,
			permissions: ["agent.command.run", "agent.command.spawn"],
			grantedPermissions: pluginState.grantedPermissions,
			declaredCommands: ["node"],
			grantedCommandNames: ["node"],
		},
	],
}));

describe("plugin command permissions", () => {
	afterEach(() => resetQuitCleanupForTest());
	beforeEach(() => {
		resetQuitCleanupForTest();
		vi.mocked(prepareCommandRuntime).mockReset().mockResolvedValue();
		vi.mocked(spawnCrossPlatformCommand).mockClear();
		pluginState.trustLevel = "local";
		pluginState.grantedPermissions = ["agent.command.run", "agent.command.spawn"];
	});

	it("waits for runtime repair and checks permission again before spawning", async () => {
		let finishRepair!: () => void;
		vi.mocked(prepareCommandRuntime).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishRepair = resolve;
				}),
		);
		const running = runPluginCommand("command-test", "node", [], undefined);
		expect(spawnCrossPlatformCommand).not.toHaveBeenCalled();
		pluginState.grantedPermissions = [];
		finishRepair();
		await expect(running).rejects.toThrow("Plugin permission denied");
		expect(spawnCrossPlatformCommand).not.toHaveBeenCalled();
	});

	it("does not launch a long-lived command when runtime repair fails", async () => {
		vi.mocked(prepareCommandRuntime).mockRejectedValue(new Error("repair required"));
		await expect(spawnPluginCommand("command-test", "node", [], undefined)).rejects.toThrow("repair required");
		expect(spawnCrossPlatformCommand).not.toHaveBeenCalled();
	});

	it("does not spawn a delayed command after restart shutdown has begun", async () => {
		let finishRepair!: () => void;
		vi.mocked(prepareCommandRuntime).mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishRepair = resolve;
				}),
		);
		const pending = spawnPluginCommand("command-test", "node", [], undefined);
		await runQuitCleanup();
		finishRepair();
		await expect(pending).rejects.toThrow("application shutdown");
		expect(spawnCrossPlatformCommand).not.toHaveBeenCalled();
	});

	it.each(["local", "community"] as const)("allows %s plugins with explicit grants", async (trustLevel) => {
		pluginState.trustLevel = trustLevel;

		await expect(runPluginCommand("command-test", "node", [], undefined)).resolves.toMatchObject({ exitCode: 0 });
		await expect(spawnPluginCommand("command-test", "node", [], undefined)).resolves.toMatchObject({ pid: 42 });
	});

	it("still rejects a command when the permission was not granted", async () => {
		pluginState.grantedPermissions = [];

		await expect(runPluginCommand("command-test", "node", [], undefined)).rejects.toThrow(
			"Plugin permission denied: agent.command.run",
		);
	});
});
