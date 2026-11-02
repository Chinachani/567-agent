export const CURRENT_BROWSER_SERVER_NAME = "567-current-browser";
export const PLAYWRIGHT_MCP_VERSION = "0.0.84";
export const BROWSER_EXTENSION_URL =
	"https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm";
export const BROWSER_EXTENSION_GUIDE_URL =
	"https://github.com/microsoft/playwright/tree/main/packages/extension#readme";

export const BROWSER_TARGETS_CHANNEL = "agent567:settings:browser-targets";
export const PREPARE_BROWSER_TARGET_CHANNEL = "agent567:settings:prepare-browser-target";
export const BROWSER_TARGET_IDS = ["chrome", "msedge", "chromium"] as const;
export type BrowserTargetId = (typeof BROWSER_TARGET_IDS)[number];
export const BROWSER_PREPARATION_ACTIONS = ["resolve", "store", "bundled"] as const;
export type BrowserPreparationAction = (typeof BROWSER_PREPARATION_ACTIONS)[number];

export interface BrowserTargets {
	readonly defaultBrowser: BrowserTargetId | null;
	readonly defaultApplication: string;
	readonly available: readonly BrowserTargetId[];
}

export interface BrowserLaunchTarget {
	readonly id: BrowserTargetId;
	/** Only system Chromium/nonstandard installs need an override; standard channels retain profile discovery. */
	readonly executablePath?: string;
}

export interface PreparedBrowserTarget extends BrowserLaunchTarget {
	/** Prepared files only; this never asserts browser-side installation or connection. */
	readonly extensionDirectory?: string;
}

export function isBrowserPreparationAction(value: unknown): value is BrowserPreparationAction {
	return BROWSER_PREPARATION_ACTIONS.some((action) => action === value);
}

export function isBrowserTargetId(value: unknown): value is BrowserTargetId {
	return BROWSER_TARGET_IDS.some((id) => id === value);
}

/** Identifies the app-created extension connection without claiming arbitrary user MCPs. */
export function isCurrentBrowserExtension(config: {
	readonly type?: string;
	readonly command?: string;
	readonly args?: readonly string[];
}): boolean {
	return (
		config.type !== "http" &&
		config.command === "npx" &&
		config.args?.includes("--extension") === true &&
		config.args.some((arg) => /^@playwright\/mcp@\d+\.\d+\.\d+$/.test(arg))
	);
}
