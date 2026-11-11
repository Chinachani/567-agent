import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ShortcutDetails } from "electron";
import { expect, it } from "vitest";
import { refreshWindowsShortcutIcons } from "./windows-shortcut-icons.js";

it("refreshes an existing installed shortcut after a background upgrade without changing its launch options or recreating deleted links", async () => {
	const root = await mkdtemp(join(tmpdir(), "agent567-shortcuts-"));
	try {
		const installRoot = join(root, "custom-install");
		await mkdir(join(installRoot, "versions", "1.5.7"), { recursive: true });
		await writeFile(join(installRoot, "current.json"), JSON.stringify({ version: "1.5.7" }));
		await writeFile(join(installRoot, "versions", "1.5.7", "567-Agent.exe"), "old electron");
		const iconPath = join(root, "brand.ico");
		await writeFile(iconPath, "new branded icon");
		const desktop = join(root, "567 Agent.lnk");
		const other = join(root, "other.lnk");
		const missing = join(root, "deleted.lnk");
		const links = new Map<string, ShortcutDetails>([
			[
				desktop,
				{
					target: join(installRoot, "567-Agent.exe"),
					args: "--custom-flag",
					cwd: installRoot,
					description: "My shortcut",
					icon: "",
					iconIndex: 0,
					appUserModelId: "",
				},
			],
			[
				other,
				{
					target: join(root, "unrelated", "567-Agent.exe"),
					args: "",
					cwd: "",
					description: "",
					icon: "other.ico",
					iconIndex: 2,
					appUserModelId: "",
				},
			],
		]);
		const shell = {
			readShortcutLink(path: string) {
				const details = links.get(path);
				if (!details) throw new Error("missing");
				return details;
			},
			writeShortcutLink(path: string, operation: "update", details: Partial<ShortcutDetails>) {
				expect(operation).toBe("update");
				const current = links.get(path);
				if (!current) return false;
				links.set(path, { ...current, ...details });
				return true;
			},
		};
		const options = {
			shell,
			shortcuts: [desktop, other, missing],
			executablePath: join(root, "data", "windows-updates", "versions", "1.5.8", "567-Agent.exe"),
			iconPath,
			iconDirectory: join(root, "data", "shortcut-icons"),
		};
		await refreshWindowsShortcutIcons(options);
		expect(links.get(desktop)).toMatchObject({
			args: "--custom-flag",
			cwd: installRoot,
			target: join(installRoot, "567-Agent.exe"),
			description: "My shortcut",
			iconIndex: 0,
		});
		const refreshed = links.get(desktop)?.icon;
		expect(refreshed).toContain("shortcut-");
		expect(await readFile(refreshed ?? "", "utf8")).toBe("new branded icon");
		expect(links.get(other)?.icon).toBe("other.ico");
		expect(links.has(missing)).toBe(false);
		await refreshWindowsShortcutIcons(options);
		expect(links.get(desktop)?.icon).toBe(refreshed);
		await rm(refreshed ?? "");
		await refreshWindowsShortcutIcons(options);
		expect(await readFile(refreshed ?? "", "utf8")).toBe("new branded icon");
		await writeFile(refreshed ?? "", "damaged icon");
		await refreshWindowsShortcutIcons(options);
		expect(await readFile(refreshed ?? "", "utf8")).toBe("new branded icon");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
