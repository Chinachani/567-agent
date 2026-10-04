import { describe, expect, it } from "vitest";
import { normalizeAbilityCategory } from "./ability-categories";

describe("normalizeAbilityCategory", () => {
	it("collapses case, spacing, and documented category aliases", () => {
		expect(normalizeAbilityCategory("Data Databases")).toBe("data-databases");
		expect(normalizeAbilityCategory("DATABASE")).toBe("data-databases");
		expect(normalizeAbilityCategory("Developer_Tools")).toBe("developer-tools");
	});

	it("maps blank categories to the uncategorized bucket", () => {
		expect(normalizeAbilityCategory("   ")).toBe("__uncategorized__");
	});
});
