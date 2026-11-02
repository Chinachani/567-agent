import { describe, expect, it } from "vitest";
import { readDevWatchState } from "./plugin-state";
import { readProjectPermissions } from "./project";

describe("workbench host values", () => {
	it("keeps only known permissions from project and reinstall payloads", () => {
		expect(readProjectPermissions(["fs.read", "agent.command.run", "made-up-permission", null, {}])).toEqual([
			"fs.read",
			"agent.command.run",
		]);
		expect(readProjectPermissions("fs.read")).toEqual([]);
	});

	it("accepts each current hot-reload state and keeps error details", () => {
		for (const status of ["starting", "running", "error"]) {
			expect(readDevWatchState({ projectDir: "/project", status, error: "build failed" })).toEqual({
				projectDir: "/project",
				status,
				error: "build failed",
			});
		}
	});

	it("handles older hosts without dev watch and ignores malformed optional fields", () => {
		for (const value of [undefined, null, false, {}, [], { projectDir: "/project", status: "unknown" }]) {
			expect(readDevWatchState(value)).toBeNull();
		}
		expect(readDevWatchState({ projectDir: "/project", status: "running", error: {} })).toEqual({
			projectDir: "/project",
			status: "running",
		});
	});
});
