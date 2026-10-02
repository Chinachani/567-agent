import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const HISTORY_FILE = "gpu-crash-history.json";
const WINDOW_MS = 10 * 60 * 1000;
const FALLBACK_THRESHOLD = 2;

export function shouldUseLinuxSoftwareRendering(userDataPath: string, now = Date.now()): boolean {
	return readRecentCrashes(userDataPath, now).length >= FALLBACK_THRESHOLD;
}

export function recordLinuxGpuCrash(userDataPath: string, now = Date.now()): number {
	const history = [...readRecentCrashes(userDataPath, now), now];
	const file = join(userDataPath, HISTORY_FILE);
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(history), { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, file);
	return history.length;
}

function readRecentCrashes(userDataPath: string, now: number): number[] {
	const file = join(userDataPath, HISTORY_FILE);
	if (!existsSync(file)) return [];
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(value): value is number =>
				typeof value === "number" && Number.isFinite(value) && value <= now && now - value <= WINDOW_MS,
		);
	} catch {
		return [];
	}
}
