import { describe, expect, it } from "vitest";
import { RUNTIME_MANIFEST } from "./paths";

describe("runtime download sources", () => {
	it("downloads Python runtime archives directly from the official release host", () => {
		expect(RUNTIME_MANIFEST.python.sources).toEqual([
			"https://github.com/astral-sh/python-build-standalone/releases/download/{release}/{filename}",
		]);
	});
});
