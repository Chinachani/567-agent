import type { McpConfigData } from "@preload/api";
import { describe, expect, it } from "vitest";
import {
	CURRENT_BROWSER_SERVER_NAME,
	readCurrentBrowserConnection,
	updateCurrentBrowserConnection,
} from "./current-browser-connection";

const input = {
	enabled: true,
	token: "",
	profile: "",
	displayName: "Current browser",
	description: "Extension connection",
};
describe("extension connection configuration", () => {
	it("retains existing CLI flags, approvals, version and unrelated environment; blank values remove only pairing fields", () => {
		const config: McpConfigData = {
			mcpServers: {
				[CURRENT_BROWSER_SERVER_NAME]: {
					command: "npx",
					args: ["-y", "@playwright/mcp@0.0.83", "--extension", "--no-tab-group"],
					autoApprove: ["browser_snapshot"],
					startupTimeout: 90000,
					disabled: true,
					env: {
						CUSTOM: "keep",
						PLAYWRIGHT_MCP_EXTENSION_TOKEN: "old",
						PLAYWRIGHT_MCP_PROFILE_DIR_NAME: "Profile 3",
					},
				},
			},
		};
		const next = updateCurrentBrowserConnection(config, input);
		expect(next.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toEqual({
			...config.mcpServers[CURRENT_BROWSER_SERVER_NAME],
			displayName: input.displayName,
			description: input.description,
			disabled: false,
			env: { CUSTOM: "keep" },
		});
		expect(config.mcpServers[CURRENT_BROWSER_SERVER_NAME].disabled).toBe(true);
		expect(readCurrentBrowserConnection(next)).toEqual({
			enabled: true,
			token: "",
			profile: "",
			conflict: false,
			browser: null,
		});
	});
	it("does not mistake an independent browser server for an extension connection", () => {
		const config: McpConfigData = {
			mcpServers: {
				[CURRENT_BROWSER_SERVER_NAME]: {
					command: "npx",
					args: ["-y", "@playwright/mcp@0.0.84"],
				},
			},
		};
		expect(readCurrentBrowserConnection(config).conflict).toBe(true);
		expect(() => updateCurrentBrowserConnection(config, input)).toThrow("current_browser_name_conflict");
	});
	it("does not create anything when disabling an absent connection", () => {
		const config = { mcpServers: {} };
		expect(updateCurrentBrowserConnection(config, { ...input, enabled: false })).toBe(config);
	});
});

it("switches only browser options, retaining pairing, approval and other flags", () => {
	const original: McpConfigData = {
		mcpServers: {
			[CURRENT_BROWSER_SERVER_NAME]: {
				command: "npx",
				args: [
					"-y",
					"@playwright/mcp@0.0.84",
					"--extension",
					"--browser=chrome",
					"--executable-path",
					"/custom/chrome",
					"--no-tab-group",
				],
				env: { KEEP: "yes", PLAYWRIGHT_MCP_BROWSER: "chrome" },
			},
		},
	};
	expect(readCurrentBrowserConnection(original).browser).toBe("custom");
	const next = updateCurrentBrowserConnection(original, {
		...input,
		browser: { id: "msedge", executablePath: "/usr/bin/microsoft-edge" },
	});
	expect(next.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
		args: ["-y", "@playwright/mcp@0.0.84", "--extension", "--no-tab-group"],
		env: {
			KEEP: "yes",
			PLAYWRIGHT_MCP_BROWSER: "msedge",
			PLAYWRIGHT_MCP_EXECUTABLE_PATH: "/usr/bin/microsoft-edge",
			AGENT567_BROWSER_TARGET: "msedge",
		},
	});
	expect(readCurrentBrowserConnection(next).browser).toBe("msedge");
	expect(readCurrentBrowserConnection(original).browser).toBe("custom");
});
it("keeps an explicit custom destination unchanged during pairing updates and disable", () => {
	const original: McpConfigData = {
		mcpServers: {
			[CURRENT_BROWSER_SERVER_NAME]: {
				command: "npx",
				args: [
					"-y",
					"@playwright/mcp@0.0.84",
					"--extension",
					"--browser",
					"chrome-beta",
					"--executable-path=/custom/browser",
				],
				env: { PLAYWRIGHT_MCP_BROWSER: "msedge" },
			},
		},
	};
	for (const enabled of [true, false]) {
		const next = updateCurrentBrowserConnection(original, { ...input, enabled });
		const previous = original.mcpServers[CURRENT_BROWSER_SERVER_NAME];
		if (previous.type === "http") throw new Error("Expected stdio fixture");
		expect(next.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({ args: previous.args });
		expect(readCurrentBrowserConnection(next).browser).toBe("custom");
	}
});
it("stores system Chromium with an explicit executable instead of the downloaded chromium channel", () => {
	const next = updateCurrentBrowserConnection(
		{ mcpServers: {} },
		{ ...input, browser: { id: "chromium", executablePath: "/usr/bin/chromium" } },
	);
	expect(next.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
		env: {
			PLAYWRIGHT_MCP_BROWSER: "chrome",
			PLAYWRIGHT_MCP_EXECUTABLE_PATH: "/usr/bin/chromium",
		},
	});
	expect(readCurrentBrowserConnection(next).browser).toBe("chromium");
});
it.each(["chrome", "msedge", "firefox", "chromium"])(
	"reads explicit %s without assuming unsupported channels are Chrome",
	(channel) => {
		expect(
			readCurrentBrowserConnection({
				mcpServers: {
					[CURRENT_BROWSER_SERVER_NAME]: {
						command: "npx",
						args: ["-y", "@playwright/mcp@0.0.84", "--extension", `--browser=${channel}`],
					},
				},
			}).browser,
		).toBe(channel === "chrome" || channel === "msedge" ? channel : "custom");
	},
);

it("uses only the standard channel for Chrome/Edge so automatic extension-profile discovery remains enabled", () => {
	const next = updateCurrentBrowserConnection({ mcpServers: {} }, { ...input, browser: { id: "msedge" } });
	expect(next.mcpServers[CURRENT_BROWSER_SERVER_NAME]).toMatchObject({
		env: { PLAYWRIGHT_MCP_BROWSER: "msedge", AGENT567_BROWSER_TARGET: "msedge" },
	});
	const server = next.mcpServers[CURRENT_BROWSER_SERVER_NAME];
	if (server.type === "http") throw new Error("Expected stdio");
	expect(server.env).not.toHaveProperty("PLAYWRIGHT_MCP_EXECUTABLE_PATH");
	expect(readCurrentBrowserConnection(next).browser).toBe("msedge");
});
