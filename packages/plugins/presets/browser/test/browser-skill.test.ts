import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_BROWSER_VERSION } from "../src/runtime/runtime-controller";

describe("Browser Use skill", () => {
	it("advertises page tasks proactively and prefers an extension without installing CLI", async () => {
		const skill = await readFile(resolve(import.meta.dirname, "../agent/skills/browser-use/SKILL.md"), "utf8");
		const description = skill.split("\n").find((line) => line.startsWith("description:"))!;
		expect(description).toContain("Use proactively");
		expect(description).toContain("verify rendered website UI");
		expect(skill).toContain("567-current-browser");
		expect(skill).toContain("use `tool_search`");
		expect(skill).toContain("does not need agent-browser runtime installation");
		expect(skill).toContain("Do not navigate to another URL just to discover which tab was chosen");
		expect(skill).toContain("Do not install or change the user's integration configuration without a request");
	});

	it("defaults to a verified current tab and keeps an independent browser opt-in", async () => {
		const skill = await readFile(resolve(import.meta.dirname, "../agent/skills/browser-use/SKILL.md"), "utf8");
		expect(skill).toContain("Default to the user's already-open browser");
		expect(skill).toContain('--auto-connect --pin-tab tab list --json');
		expect(skill).toContain("Do not silently fall back to a managed browser when attachment fails");
		expect(skill).toContain("Create a separate task browser only when the user explicitly requests");
		expect(skill).toContain("Do not restart or close their browser");
		expect(skill).toContain("mouse move <x> <y>");
		expect(skill).toContain("Verify the resulting page");
	});

	it("routes the Agent through an isolated upstream CLI session", async () => {
		const skill = await readFile(resolve(import.meta.dirname, "../agent/skills/browser-use/SKILL.md"), "utf8");
		expect(skill).toContain("agent-browser");
		expect(skill).toContain("AGENT567_AGENT_SESSION_ID");
		expect(skill).toContain("--session");
		expect(skill).toContain("--pin-tab");
		expect(skill).toContain('click "@e1"');
		expect(skill).not.toContain("browser_operate");
	});

	it("bootstraps only the pinned Vetta-managed runtime before browser operations", async () => {
		const skill = await readFile(resolve(import.meta.dirname, "../agent/skills/browser-use/SKILL.md"), "utf8");
		expect(skill).toContain(`npm install --global agent-browser@${AGENT_BROWSER_VERSION} --engine-strict=false`);
		expect(skill).toContain("npm_config_prefix");
		expect(skill).toContain("npm config get prefix");
		expect(skill).toContain("agent-browser doctor --json");
		expect(skill).toContain("agent-browser install");
		expect(skill).toContain("Never run `agent-browser upgrade`");
		expect(skill).toContain("Never run `doctor --fix` automatically");
		expect(skill).not.toContain("If unavailable, ask the user to install it");
	});
});
