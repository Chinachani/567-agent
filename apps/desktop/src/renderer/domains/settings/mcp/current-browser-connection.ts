import type { McpConfigData, McpStdioServerConfigData } from "@preload/api";

import {
	type BrowserLaunchTarget,
	type BrowserTargetId,
	CURRENT_BROWSER_SERVER_NAME,
	isBrowserTargetId,
	isCurrentBrowserExtension,
	PLAYWRIGHT_MCP_VERSION,
} from "../../../../shared/current-browser-connection";

export {
	BROWSER_EXTENSION_GUIDE_URL,
	BROWSER_EXTENSION_URL,
	CURRENT_BROWSER_SERVER_NAME,
	PLAYWRIGHT_MCP_VERSION,
} from "../../../../shared/current-browser-connection";

const TOKEN_KEY = "PLAYWRIGHT_MCP_EXTENSION_TOKEN";
const PROFILE_KEY = "PLAYWRIGHT_MCP_PROFILE_DIR_NAME";
const BROWSER_KEY = "PLAYWRIGHT_MCP_BROWSER";
const EXECUTABLE_KEY = "PLAYWRIGHT_MCP_EXECUTABLE_PATH";
// Records ownership of the executable resolved by Desktop; arbitrary user paths stay custom.
const TARGET_KEY = "AGENT567_BROWSER_TARGET";
const DEFAULT_ARGS = ["-y", `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, "--extension"];

export interface CurrentBrowserConnection {
	readonly enabled: boolean;
	readonly token: string;
	readonly profile: string;
	readonly conflict: boolean;
	readonly browser: BrowserTargetId | "custom" | null;
}

function optionValue(args: readonly string[], option: string): string | undefined {
	let value: string | undefined;
	for (let index = 0; index < args.length; index++) {
		if (args[index] === option) value = args[++index] ?? "";
		else if (args[index].startsWith(`${option}=`)) value = args[index].slice(option.length + 1);
	}
	return value;
}

function readBrowser(server: McpStdioServerConfigData): CurrentBrowserConnection["browser"] {
	const args = server.args ?? [];
	const channelOption = optionValue(args, "--browser");
	const executableOption = optionValue(args, "--executable-path");
	const channel = channelOption ?? server.env?.[BROWSER_KEY];
	const executable = executableOption ?? server.env?.[EXECUTABLE_KEY];
	const owned = server.env?.[TARGET_KEY];
	if (
		isBrowserTargetId(owned) &&
		channelOption === undefined &&
		executableOption === undefined &&
		(owned !== "chromium" || executable) &&
		channel === (owned === "chromium" ? "chrome" : owned)
	)
		return owned;
	if (executable !== undefined || optionValue(args, "--config") !== undefined) return "custom";
	if (channel === undefined) return null;
	// Playwright's `chromium` channel starts its downloaded browser, not system Chromium.
	return channel === "chrome" || channel === "msedge" ? channel : "custom";
}

function withoutBrowserOptions(args: readonly string[]): string[] {
	const result: string[] = [];
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "--browser" || args[index] === "--executable-path") index++;
		else if (!/^--(?:browser|executable-path)=/.test(args[index])) result.push(args[index]);
	}
	return result;
}

function isExtensionConnection(server: McpConfigData["mcpServers"][string]): server is McpStdioServerConfigData {
	return server.type !== "http" && isCurrentBrowserExtension(server);
}

export function readCurrentBrowserConnection(config: McpConfigData): CurrentBrowserConnection {
	const server = config.mcpServers[CURRENT_BROWSER_SERVER_NAME];
	const compatible = server && isExtensionConnection(server);
	return {
		enabled: Boolean(compatible && !server.disabled),
		token: compatible ? (server.env?.[TOKEN_KEY] ?? "") : "",
		profile: compatible ? (server.env?.[PROFILE_KEY] ?? "") : "",
		conflict: Boolean(server && !compatible),
		browser: compatible ? readBrowser(server) : null,
	};
}

/** Merge only this connection into a freshly read document. Custom servers and custom CLI options survive. */
export function updateCurrentBrowserConnection(
	config: McpConfigData,
	input: {
		enabled: boolean;
		token: string;
		profile: string;
		displayName: string;
		description: string;
		browser?: BrowserLaunchTarget;
	},
): McpConfigData {
	const existing = config.mcpServers[CURRENT_BROWSER_SERVER_NAME];
	if (existing && !isExtensionConnection(existing)) throw new Error("current_browser_name_conflict");
	if (!existing && !input.enabled) return config;
	const env = { ...existing?.env };
	let args = existing?.args ?? [...DEFAULT_ARGS];
	// Disabling retains the persisted pairing data.
	if (input.enabled) {
		if (input.browser) {
			args = withoutBrowserOptions(args);
			env[BROWSER_KEY] = input.browser.id === "chromium" ? "chrome" : input.browser.id;
			if (input.browser.executablePath) env[EXECUTABLE_KEY] = input.browser.executablePath;
			else delete env[EXECUTABLE_KEY];
			env[TARGET_KEY] = input.browser.id;
		}
		for (const [key, value] of [
			[TOKEN_KEY, input.token],
			[PROFILE_KEY, input.profile],
		]) {
			if (value.trim()) env[key] = value.trim();
			else delete env[key];
		}
	}
	return {
		...config,
		mcpServers: {
			...config.mcpServers,
			[CURRENT_BROWSER_SERVER_NAME]: {
				...(existing ?? { command: "npx", args: [...DEFAULT_ARGS], startupTimeout: 120_000 }),
				displayName: input.displayName,
				description: input.description,
				disabled: !input.enabled,
				args,
				env,
			},
		},
	};
}
