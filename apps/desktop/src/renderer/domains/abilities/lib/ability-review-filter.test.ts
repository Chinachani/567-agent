import { describe, expect, it } from "vitest";
import type { SkillAbility } from "../types";
import { filterAbilityCatalog } from "./ability-catalog-query";

function skill(id: string, overrides: Partial<SkillAbility> = {}): SkillAbility {
	return {
		id: `skill:${id}`,
		slug: id,
		type: "skill",
		catalogSource: { kind: "server", id: "server" },
		title: id,
		description: "",
		category: "data-databases",
		tags: [],
		author: "",
		license: "",
		version: "1",
		installed: false,
		enabled: false,
		readonly: false,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: false,
		fromMarket: true,
		searchTerms: [id],
		...overrides,
	};
}

describe("ability review and tag filters", () => {
	it("combines explicit unreviewed status with a case-insensitive tag without inferring approval", () => {
		const unreviewed = skill("unreviewed", { reviewStatus: "unreviewed", tags: ["Data", "Database"] });
		const unmarked = skill("unmarked", { tags: ["Data"] });
		const byTagOnly = filterAbilityCatalog([unreviewed, unmarked], { scope: "discover", tag: "data" });

		const reviewedOnly = filterAbilityCatalog([unreviewed, unmarked], {
			scope: "discover",
			reviewFilter: "unreviewed",
			tag: "data",
		});

		expect(byTagOnly.map((item) => item.id)).toEqual([unreviewed.id, unmarked.id]);
		expect(reviewedOnly.map((item) => item.id)).toEqual([unreviewed.id]);
	});
});
