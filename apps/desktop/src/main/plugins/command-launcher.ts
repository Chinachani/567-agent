import type { ChildProcess, SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import crossSpawn from "cross-spawn";
import { executablePathFor } from "../runtimes/paths.js";
import { nodePackageManagerPaths } from "../runtimes/runtime-health.js";

export interface CommandInvocation {
	file: string;
	args: string[];
}

export interface ManagedNodeCommandPaths {
	node: string;
	npmCli: string;
	npxCli: string;
}

function getManagedNodeCommandPaths(): ManagedNodeCommandPaths {
	const node = executablePathFor("node");
	return {
		node,
		...nodePackageManagerPaths(node),
	};
}

/** Called only after the plugin's command permission has been checked. */
export async function prepareCommandRuntime(file: string): Promise<void> {
	if (file !== "node" && file !== "npm" && file !== "npx") return;
	const { getRuntimeManager } = await import("../runtimes/manager.js");
	await getRuntimeManager().ensureReady("node");
}

/**
 * Resolve logical Node toolchain commands to the managed runtime when it is
 * available. Other commands stay logical and are resolved by cross-spawn.
 */
export function resolveCommandInvocation(
	file: string,
	args: readonly string[],
	managedPaths: ManagedNodeCommandPaths = getManagedNodeCommandPaths(),
): CommandInvocation {
	if (!existsSync(managedPaths.node)) return { file, args: [...args] };
	if (file === "node") return { file: managedPaths.node, args: [...args] };
	if (file === "npm" && existsSync(managedPaths.npmCli)) {
		return { file: managedPaths.node, args: [managedPaths.npmCli, ...args] };
	}
	if (file === "npx" && existsSync(managedPaths.npxCli)) {
		return { file: managedPaths.node, args: [managedPaths.npxCli, ...args] };
	}
	return { file, args: [...args] };
}

/** Spawn without a caller-controlled shell; cross-spawn only bridges platform script shims. */
export function spawnCrossPlatformCommand(file: string, args: readonly string[], options: SpawnOptions): ChildProcess {
	const invocation = resolveCommandInvocation(file, args);
	return crossSpawn(invocation.file, invocation.args, options);
}
