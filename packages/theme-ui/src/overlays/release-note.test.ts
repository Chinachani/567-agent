import { expect, it } from "vitest";
import { parseReleaseNote } from "./release-note";

it("extracts only a matching standard title and valid adjacent date", () => {
	expect(parseReleaseNote("# 567 Agent 1.5.4\n\n2026-11-02\n\n## New\n- Item", "1.5.4")).toEqual({
		body: "## New\n- Item",
		date: "2026-11-02",
	});
	for (const source of [
		"# Other project\n2026-11-02\nKeep",
		"```md\n# v1.5.4\n2026-11-02\n```",
		"## v1.5.4\n2026-11-02",
	])
		expect(parseReleaseNote(source).body).toBe(source);
	expect(parseReleaseNote("# v1.5.4\nKeep", "1.5.3").body).toBe("# v1.5.4\nKeep");
	expect(parseReleaseNote("# v1.5.4\n2026-02-31\nKeep").date).toBeUndefined();
});
