import { describe, expect, it } from "vitest";
import { RUNTIME_MANIFEST } from "./paths";

describe("runtime download sources", () => {
	it("tries the NJU mirror before the official Python runtime release host", () => {
		expect(RUNTIME_MANIFEST.python.sources).toEqual([
			"https://mirror.nju.edu.cn/github-release/astral-sh/python-build-standalone/{release}/{filename}",
			"https://github.com/astral-sh/python-build-standalone/releases/download/{release}/{filename}",
		]);
	});
});
