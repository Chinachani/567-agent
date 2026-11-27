import { describe, expect, it } from "vitest";
import { groupEntriesForSelection } from "./group-display";

describe("groupEntriesForSelection", () => {
	it("places the active primary group first while preserving the remaining order", () => {
		expect(
			groupEntriesForSelection(
				{
					默认分组: { ratio: 1 },
					"chat GPT pro": { ratio: 1 },
					"Google Gemini": { ratio: 1 },
				},
				"Google Gemini",
			).map(([name]) => name),
		).toEqual(["Google Gemini", "默认分组", "chat GPT pro"]);
	});

	it("keeps the backend order when no primary group is selected", () => {
		expect(groupEntriesForSelection({ first: {}, second: {} }).map(([name]) => name)).toEqual(["first", "second"]);
	});
});
