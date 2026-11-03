import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { app } from "electron";
import {
	BROWSER_EXTENSION_URL,
	BROWSER_TARGET_IDS,
	type BrowserPreparationAction,
	type BrowserTargetId,
	type BrowserTargets,
	type PreparedBrowserTarget,
} from "../../shared/current-browser-connection.js";
import { prepareBundledExtension } from "./bundled-extension.js";

/** Application metadata only: never reads browser profiles, tabs or extension state. */
export function identifyBrowserApplication(name: string): BrowserTargetId | null {
	const normalized = name
		.trim()
		.toLowerCase()
		.replace(/\.desktop$/, "");
	if (/^(microsoft[- ]edge|msedge)(-stable)?$/.test(normalized)) return "msedge";
	if (/^(google[- ]chrome|chrome)(-stable)?$/.test(normalized)) return "chrome";
	if (/^chromium(-browser)?$/.test(normalized)) return "chromium";
	return null;
}

// Explicit destinations use known application locations, never a renderer-supplied command.
export function browserExecutableCandidates(
	id: BrowserTargetId,
	platform: NodeJS.Platform,
	home: string,
	env: NodeJS.ProcessEnv,
): string[] {
	if (platform === "darwin") {
		const name = { chrome: "Google Chrome", msedge: "Microsoft Edge", chromium: "Chromium" }[id];
		return ["/Applications", path.posix.join(home, "Applications")].map((root) =>
			path.posix.join(root, `${name}.app`, "Contents", "MacOS", name),
		);
	}
	if (platform === "win32") {
		const suffix = {
			chrome: "Google/Chrome/Application/chrome.exe",
			msedge: "Microsoft/Edge/Application/msedge.exe",
			chromium: "Chromium/Application/chrome.exe",
		}[id];
		return [
			env.LOCALAPPDATA,
			env.PROGRAMFILES,
			env["PROGRAMFILES(X86)"],
			...(env.HOMEDRIVE ? [`${env.HOMEDRIVE}\\Program Files`, `${env.HOMEDRIVE}\\Program Files (x86)`] : []),
		]
			.filter((root): root is string => Boolean(root))
			.map((root) => path.win32.join(root, suffix));
	}
	if (platform !== "linux") return [];
	return {
		chrome: ["/opt/google/chrome/chrome", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"],
		msedge: ["/opt/microsoft/msedge/msedge", "/usr/bin/microsoft-edge-stable", "/usr/bin/microsoft-edge"],
		chromium: ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"],
	}[id];
}

async function isExecutable(file: string): Promise<boolean> {
	try {
		await access(file, process.platform === "win32" ? constants.F_OK : constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

interface ResolvedBrowserTarget {
	id: BrowserTargetId;
	executablePath: string;
	customExecutable: boolean;
}

async function inspectTargets(): Promise<{ summary: BrowserTargets; targets: ResolvedBrowserTarget[] }> {
	let defaultApplication = "";
	try {
		defaultApplication = app.getApplicationNameForProtocol("https://example.com");
	} catch {
		// Manual selection remains available when the OS has no registered HTTPS handler.
	}
	const defaultBrowser = identifyBrowserApplication(defaultApplication);
	let defaultPath: string | undefined;
	if (defaultBrowser && (process.platform === "darwin" || process.platform === "win32")) {
		try {
			const info = await app.getApplicationInfoForProtocol("https://example.com");
			defaultPath = info.path;
			if (process.platform === "darwin" && defaultPath.endsWith(".app")) {
				const executable = { chrome: "Google Chrome", msedge: "Microsoft Edge", chromium: "Chromium" }[
					defaultBrowser
				];
				defaultPath = path.posix.join(defaultPath, "Contents", "MacOS", executable);
			}
		} catch {
			// Standard install locations still work if OS application details are unavailable.
		}
	}
	const candidates = await Promise.all(
		BROWSER_TARGET_IDS.map(async (id): Promise<ResolvedBrowserTarget | null> => {
			const paths = browserExecutableCandidates(id, process.platform, homedir(), process.env);
			// Match the pinned connector's channel lookup, preserving automatic extension-profile discovery.
			const channelPaths = process.platform === "win32" ? [...paths] : paths.slice(0, 1);
			if (id === defaultBrowser && defaultPath) paths.unshift(defaultPath);
			const accessible = await Promise.all(paths.map(isExecutable));
			const executablePath = paths.find((_file, index) => accessible[index]);
			if (!executablePath) return null;
			const channelPath = channelPaths.find((file) => accessible[paths.indexOf(file)]);
			const normalize = (file: string | undefined) =>
				process.platform === "win32" && file ? path.win32.normalize(file).toLowerCase() : file;
			return {
				id,
				executablePath,
				customExecutable: id === "chromium" || normalize(channelPath) !== normalize(executablePath),
			};
		}),
	);
	const targets = candidates.filter((target): target is ResolvedBrowserTarget => target !== null);
	return { summary: { defaultBrowser, defaultApplication, available: targets.map((target) => target.id) }, targets };
}

export async function getBrowserTargets(): Promise<BrowserTargets> {
	return (await inspectTargets()).summary;
}

export async function prepareBrowserTarget(
	id: BrowserTargetId,
	action: BrowserPreparationAction,
): Promise<PreparedBrowserTarget> {
	const target = (await inspectTargets()).targets.find((entry) => entry.id === id);
	if (!target) throw new Error("browser_target_unavailable");
	let extensionDirectory: string | undefined;
	if (action === "bundled") {
		try {
			extensionDirectory = await prepareBundledExtension();
		} catch {
			throw new Error("browser_extension_prepare_failed");
		}
	}
	if (action !== "resolve") {
		const url =
			action === "store" ? BROWSER_EXTENSION_URL : id === "msedge" ? "edge://extensions/" : "chrome://extensions/";
		await new Promise<void>((resolve, reject) => {
			const child = spawn(target.executablePath, [url], {
				shell: false,
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			});
			child.once("error", reject);
			child.once("spawn", () => {
				child.unref();
				resolve();
			});
		});
	}
	return {
		id: target.id,
		...(target.customExecutable ? { executablePath: target.executablePath } : {}),
		...(extensionDirectory ? { extensionDirectory } : {}),
	};
}
