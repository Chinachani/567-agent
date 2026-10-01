import { describe, expect, it } from "vitest";
import { findDesignSharePath, isDesignSharePath } from "./app-lifecycle-ipc";

describe("design share file association", () => {
	it("recognizes the new extension without case sensitivity", () => {
		expect(isDesignSharePath("C:\\designs\\preview.567design")).toBe(true);
		expect(isDesignSharePath("/tmp/preview.567DESIGN")).toBe(true);
		expect(isDesignSharePath("/tmp/preview.vetdz")).toBe(false);
	});

	it("finds an associated document passed to a second application instance", () => {
		expect(findDesignSharePath(["567-Agent", "--some-flag", "/tmp/design.567design"])).toBe("/tmp/design.567design");
		expect(findDesignSharePath(["567-Agent", "--some-flag"])).toBeUndefined();
	});
});
