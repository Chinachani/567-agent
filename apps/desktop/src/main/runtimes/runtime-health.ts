import { spawnSync } from "node:child_process";

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
