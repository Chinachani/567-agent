import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The legacy path is also read by current Apport. Exact executable matching
// prevents a crash dialog from respawning Chromium child arguments, without
// disabling crash reporting for any other application.
export const APPORT_POLICY_PATH = "/etc/apport/blacklist.d/567-agent";
export const LINUX_EXECUTABLE_PATH = "/opt/567-agent/567-agent";
export const APPORT_POLICY_CONTENT = `# Chromium child processes must not be restarted as standalone applications.\n${LINUX_EXECUTABLE_PATH}\n`;

export async function stageLinuxCrashPolicy(stageDirectory) {
	const source = join(stageDirectory, "build", "apport", "567-agent");
	await mkdir(join(stageDirectory, "build", "apport"), { recursive: true });
	await writeFile(source, APPORT_POLICY_CONTENT, { mode: 0o644 });
	return [`${source}=${APPORT_POLICY_PATH}`];
}

export function verifyLinuxCrashPolicy(contents) {
	const entries = contents
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line && !line.startsWith("#"));
	if (entries.length !== 1 || entries[0] !== LINUX_EXECUTABLE_PATH) {
		throw new Error("Linux Apport policy must match only the packaged 567 Agent executable");
	}
}
