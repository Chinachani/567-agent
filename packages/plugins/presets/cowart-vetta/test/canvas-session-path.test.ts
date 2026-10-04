import { describe, expect, it } from "vitest";
import { getSessionCanvasDir } from "../src/canvas-session-path";

describe("getSessionCanvasDir", () => {
	it("uses the stable session file name under the project canvas root", () => {
		expect(getSessionCanvasDir("/workspace/demo", "/sessions/7f8b3.jsonl")).toBe(
			"/workspace/demo/canvas/sessions/7f8b3",
		);
	});

	it("keeps Windows paths in one encoded session directory", () => {
		expect(getSessionCanvasDir("C:\\work\\demo", "C:\\sessions\\folder name.jsonl")).toBe(
			"C:\\work\\demo\\canvas\\sessions\\folder%20name",
		);
	});

	it("rejects session paths without a file name", () => {
		expect(() => getSessionCanvasDir("/workspace/demo", "/sessions/")).toThrow("session path");
	});
});
