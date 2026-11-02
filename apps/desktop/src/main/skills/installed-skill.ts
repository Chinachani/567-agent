import type { SkillProvenance } from "../../preload/api-types/skills.js";

export type InstalledSkillType = "skill";

export interface InstalledMarketSkill {
	name: string;
	version: string;
	installedAt: string;
	source: "market";
	enabled: boolean;
	type?: InstalledSkillType;
	alias?: string;
	marketDescription?: string;
}

export interface InstalledCustomSkill {
	name: string;
	version: string;
	installedAt: string;
	source: "custom";
	enabled: boolean;
	type: InstalledSkillType;
	provenance?: SkillProvenance;
	alias?: string;
	description: string;
}

export type InstalledSkill = InstalledMarketSkill | InstalledCustomSkill;
