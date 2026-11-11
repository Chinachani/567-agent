import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { ShortcutDetails } from "electron";
import { getAppLogger } from "./logger.js";

interface ShortcutIconOptions {
	shell: {
		readShortcutLink(path: string): Pick<ShortcutDetails, "target" | "icon" | "iconIndex">;
		writeShortcutLink(
			path: string,
			operation: "update",
			details: { target: string; icon: string; iconIndex: number },
		): boolean;
	};
	shortcuts: readonly string[];
	executablePath: string;
	iconPath: string;
	iconDirectory: string;
}

async function isAppTarget(target: string, executablePath: string): Promise<boolean> {
	if (resolve(target).toLowerCase() === resolve(executablePath).toLowerCase()) return true;
	if (basename(target).toLowerCase() !== "567-agent.exe") return false;
	try {
		// Older shortcuts target the installed bootstrapper, while the running
		// Electron binary may now live in the user's update store.
		const root = dirname(target);
		const pointer: unknown = JSON.parse(await readFile(join(root, "current.json"), "utf8"));
		if (!pointer || typeof pointer !== "object" || !("version" in pointer)) return false;
		const version = pointer.version;
		if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version)) return false;
		return (await stat(join(root, "versions", version, "567-Agent.exe"))).isFile();
	} catch {
		return false;
	}
}

/** Refresh only existing, verified app shortcuts; never create a deleted shortcut. */
export async function refreshWindowsShortcutIcons(options: ShortcutIconOptions): Promise<void> {
	const icon = await readFile(options.iconPath);
	// A content-specific filename also invalidates Explorer's old icon cache.
	const digest = createHash("sha256").update(icon).digest("hex").slice(0, 16);
	const destination = join(options.iconDirectory, `shortcut-${digest}.ico`);
	let prepared = false;
	for (const shortcut of options.shortcuts) {
		try {
			const current = options.shell.readShortcutLink(shortcut);
			if (!current.target || !(await isAppTarget(current.target, options.executablePath))) continue;
			if (!prepared) {
				await mkdir(options.iconDirectory, { recursive: true });
				const existing = await readFile(destination).catch(() => undefined);
				if (!existing?.equals(icon)) await writeFile(destination, icon);
				prepared = true;
			}
			if (current.icon === destination && current.iconIndex === 0) continue;
			// update preserves the original target, arguments, working directory,
			// description and shortcut choices, including customized launch args.
			if (
				!options.shell.writeShortcutLink(shortcut, "update", {
					target: current.target,
					icon: destination,
					iconIndex: 0,
				})
			) {
				getAppLogger("windows-shortcuts").warn("unable to refresh an app shortcut icon");
			}
		} catch {
			// Missing, unreadable or shared shortcuts must not prevent startup.
		}
	}
}
