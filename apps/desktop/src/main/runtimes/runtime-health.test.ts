import { describe, expect, it } from "vitest";
import { probeRuntimeExecutable } from "./runtime-health";

describe("probeRuntimeExecutable", () => {
	it("requires an executable to return the exact expected version", () => {
		expect(probeRuntimeExecutable(process.execPath, process.version.slice(1))).toMatchObject({
			ready: true,
			detectedVersion: process.version.slice(1),
		});
		expect(probeRuntimeExecutable(process.execPath, "0.0.0").ready).toBe(false);
	});

	it("reports missing or non-runnable runtime files as not ready", () => {
		expect(probeRuntimeExecutable("/path/that/does/not/exist", "22.22.2")).toMatchObject({ ready: false });
	});
});
