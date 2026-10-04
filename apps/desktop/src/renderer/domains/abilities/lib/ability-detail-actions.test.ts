import { describe, expect, it } from "vitest";
import type { McpAbility } from "../types";
import { resolveAbilityPrimaryAction, resolveAbilityStatus } from "./ability-detail-actions";

function discoveryOnlyMcp(): McpAbility {
	return {
		id: "mcp:blender-mcp",
		slug: "blender-mcp",
		type: "mcp",
		mcpMetadata: {
			runtimeMode: "unknown",
			platforms: ["unknown"],
			permissionScopes: ["unknown"],
			authentication: "unknown",
			publisherType: "unknown",
			installable: false,
		},
		readonly: false,
		installed: false,
		needsUpdate: false,
		setupRequired: false,
		enabled: false,
	} as McpAbility;
}

describe("ability detail actions", () => {
	it("does not offer installation for discovery-only MCP entries", () => {
		const item = discoveryOnlyMcp();
		expect(resolveAbilityPrimaryAction(item, resolveAbilityStatus(item))).toBe("none");
	});
});
