import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { RuntimeType } from "./paths.js";

export interface RuntimeHealth {
	ready: boolean;
	detectedVersion?: string;
	error?: string;
}

export function probeRuntimeExecutable(executablePath: string, expectedVersion: string): RuntimeHealth {
	try {
		const result = spawnSync(executablePath, ["--version"], {
			encoding: "utf-8",
			timeout: 5000,
			windowsHide: true,
		});
		const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
		const detectedVersion = output.match(/(\d+\.\d+\.\d+)/)?.[1];
		const ready = result.status === 0 && detectedVersion === expectedVersion;
		return {
			ready,
			detectedVersion,
			error: ready ? undefined : (result.error?.message ?? (output.trim() || `exit ${result.status}`)),
		};
	} catch (error) {
		return { ready: false, error: error instanceof Error ? error.message : String(error) };
	}
}

export function nodePackageManagerPaths(executablePath: string): { npmCli: string; npxCli: string } {
	const binaryDirectory = dirname(executablePath);
	const packageDirectory =
		basename(executablePath).toLowerCase() === "node.exe"
			? join(binaryDirectory, "node_modules", "npm")
			: join(binaryDirectory, "..", "lib", "node_modules", "npm");
	return {
		npmCli: join(packageDirectory, "bin", "npm-cli.js"),
		npxCli: join(packageDirectory, "bin", "npx-cli.js"),
	};
}

export function hasNodePackageManagerFiles(executablePath: string): boolean {
	const { npmCli, npxCli } = nodePackageManagerPaths(executablePath);
	return existsSync(npmCli) && existsSync(npxCli);
}

/** Node itself can run while its bundled npm tree is missing or only partly extracted. */
export function probeManagedRuntime(type: RuntimeType, executablePath: string, expectedVersion: string): RuntimeHealth {
	const health = probeRuntimeExecutable(executablePath, expectedVersion);
	if (!health.ready || type !== "node") return health;
	const { npmCli, npxCli } = nodePackageManagerPaths(executablePath);
	for (const entry of [npmCli, npxCli]) {
		if (!existsSync(entry)) return { ...health, ready: false, error: `Node package manager entry missing: ${entry}` };
	}
	try {
		for (const entry of [npmCli, npxCli]) {
			const result = spawnSync(executablePath, [entry, "--version"], {
				encoding: "utf-8",
				timeout: 5000,
				windowsHide: true,
			});
			const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
			if (result.status !== 0 || !/^\d+\.\d+\.\d+$/.test(result.stdout?.trim() ?? "")) {
				return {
					...health,
					ready: false,
					error: `${basename(entry)} health check failed: ${result.error?.message ?? (output || `exit ${result.status}`)}`,
				};
			}
		}
		return health;
	} catch (error) {
		return { ...health, ready: false, error: error instanceof Error ? error.message : String(error) };
	}
}
