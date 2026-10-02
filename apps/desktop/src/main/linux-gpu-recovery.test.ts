import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordLinuxGpuCrash, shouldUseLinuxSoftwareRendering } from "./linux-gpu-recovery.js";

const directories: string[] = [];
const NOW = 1_800_000_000_000;

afterEach(() => {
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("Linux GPU recovery policy", () => {
	it("waits for repeated recent GPU crashes before enabling software rendering", () => {
		const directory = createDirectory();
		expect(shouldUseLinuxSoftwareRendering(directory, NOW)).toBe(false);
		recordLinuxGpuCrash(directory, NOW - 5_000);
		expect(shouldUseLinuxSoftwareRendering(directory, NOW)).toBe(false);
		recordLinuxGpuCrash(directory, NOW);
		expect(shouldUseLinuxSoftwareRendering(directory, NOW)).toBe(true);
	});

	it("ignores stale crash records", () => {
		const directory = createDirectory();
		recordLinuxGpuCrash(directory, NOW - 11 * 60 * 1000);
		recordLinuxGpuCrash(directory, NOW - 10 * 60 * 1000 - 1);
		expect(shouldUseLinuxSoftwareRendering(directory, NOW)).toBe(false);
	});
});

function createDirectory(): string {
	const directory = mkdtempSync(join(tmpdir(), "567-linux-gpu-recovery-"));
	directories.push(directory);
	return directory;
}
