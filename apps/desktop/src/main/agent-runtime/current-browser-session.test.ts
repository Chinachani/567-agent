import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpClientHandle, McpInitializeResult, McpJsonObject } from "@567agent/runtime-mcp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURRENT_BROWSER_SERVER_NAME, PLAYWRIGHT_MCP_VERSION } from "../../shared/current-browser-connection.js";
import { createDesktopMcpSupervisor } from "./mcp-supervisor.js";

vi.mock("@567agent/runtime-node/mcp", async (importActual) => {
	const actual = await importActual<Record<string, unknown>>();
	return { ...actual, createMcpClient: (name: string) => new TabClient(name) };
});

/** The only fake is the external browser transport; config loading, partitioning and lifecycle are real. */
class TabClient implements McpClientHandle {
	closed = false;
	private title = "No selected tab";
	constructor(private readonly name: string) {}
	async initialize(): Promise<McpInitializeResult> {
		return {
			protocolVersion: "2025-11-25",
			serverInfo: { name: this.name, version: "test" },
			capabilities: { tools: {} },
		};
	}
	async listTools() {
		return { tools: [{ name: "browser_snapshot", inputSchema: { type: "object" as const } }] };
	}
	async callTool(name: string, args?: McpJsonObject) {
		if (this.closed) throw new Error("closed");
		if (name === "select" && typeof args?.title === "string") this.title = args.title;
		return { content: [{ type: "text" as const, text: this.title }] };
	}
	async listResources() {
		return { resources: [] };
	}
	async readResource() {
		return { contents: [] };
	}
	async listPrompts() {
		return { prompts: [] };
	}
	async close() {
		this.closed = true;
	}
	getName() {
		return this.name;
	}
	getPid() {
		return undefined;
	}
	isClientInitialized() {
		return !this.closed;
	}
}
const directories: string[] = [];
afterEach(() => {
	for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function setup() {
	const dir = mkdtempSync(join(tmpdir(), "agent567-browser-session-"));
	directories.push(dir);
	const extension = { command: "npx", args: ["-y", `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`, "--extension"] };
	const path = join(dir, "mcp.json");
	const write = (disabled = false) =>
		writeFileSync(
			path,
			JSON.stringify({
				mcpServers: {
					[CURRENT_BROWSER_SERVER_NAME]: { ...extension, disabled },
					docs: { command: "docs-connector" },
				},
			}),
		);
	write();
	return { dir, write };
}

describe("current browser MCP ownership", () => {
	it("keeps ordinary connectors pooled and gives concurrent sessions independent tab state and cleanup", async () => {
		const { dir, write } = setup();
		const options = { projectRoot: dir, agentDir: dir, debug: false };
		const shared = createDesktopMcpSupervisor(options);
		const first = createDesktopMcpSupervisor({ ...options, fileScope: "session" });
		const second = createDesktopMcpSupervisor({ ...options, fileScope: "session" });
		try {
			await Promise.all([shared.initialize(), first.initialize(), second.initialize()]);
			expect(shared.getReadyServerBindings().map((b) => b.view.name)).toEqual(["docs"]);
			expect(first.getReadyServerBindings().map((b) => b.view.name)).toEqual([CURRENT_BROWSER_SERVER_NAME]);
			const a = first.getReadyServerBindings()[0];
			const b = second.getReadyServerBindings()[0];
			expect(a.client).not.toBe(b.client);
			await a.client!.callTool("select", { title: "Task A page" });
			await b.client!.callTool("select", { title: "Task B page" });
			expect((await a.client!.callTool("browser_snapshot")).content).toEqual([
				{ type: "text", text: "Task A page" },
			]);
			expect((await b.client!.callTool("browser_snapshot")).content).toEqual([
				{ type: "text", text: "Task B page" },
			]);
			// Disabling retires the old connection while a running Turn retains its lease.
			const lease = a.acquireLease();
			write(true);
			await first.reloadIfChanged();
			expect(first.getReadyServerBindings()).toHaveLength(0);
			expect((a.client as TabClient).closed).toBe(false);
			await lease.release();
			expect((a.client as TabClient).closed).toBe(true);
			await first.shutdown();
			expect((b.client as TabClient).closed).toBe(false);
			await second.reloadIfChanged();
			expect((b.client as TabClient).closed).toBe(true);
		} finally {
			await Promise.all([shared.shutdown(), first.shutdown(), second.shutdown()]);
		}
	});

	it("classifies after project overrides and leaves same-name custom servers in their original shared scope", async () => {
		const { dir } = setup();
		mkdirSync(join(dir, ".567agent"));
		writeFileSync(
			join(dir, ".567agent", "mcp.json"),
			JSON.stringify({
				mcpServers: {
					[CURRENT_BROWSER_SERVER_NAME]: { command: "custom-browser-program", args: [] },
				},
			}),
		);
		const shared = createDesktopMcpSupervisor({ projectRoot: dir, agentDir: dir, debug: false });
		const session = createDesktopMcpSupervisor({
			projectRoot: dir,
			agentDir: dir,
			debug: false,
			fileScope: "session",
		});
		try {
			await Promise.all([shared.initialize(), session.initialize()]);
			expect(shared.getReadyServerBindings().map((b) => b.view.name)).toContain(CURRENT_BROWSER_SERVER_NAME);
			expect(session.getReadyServerBindings()).toHaveLength(0);
			await session.setDynamicServers({
				servers: new Map([["plugin-existing-tool", { command: "existing-plugin" }]]),
				signature: "plugin-v1",
			});
			expect(session.getReadyServerBindings().map((b) => b.view.name)).toEqual(["plugin-existing-tool"]);
		} finally {
			await Promise.all([shared.shutdown(), session.shutdown()]);
		}
	});
});
