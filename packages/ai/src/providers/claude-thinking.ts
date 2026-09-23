import type { SimpleStreamOptions } from "../types.js";

export type ClaudeEffort = "low" | "medium" | "high" | "max";

interface ClaudeVersion {
	family: string;
	major: number;
	minor: number;
}

// Date suffixes have more than two digits and must not be mistaken for a minor version.
const FAMILY_VERSION_PATTERN = /(opus|sonnet|haiku|fable|mythos)-(\d+)(?:[-.](\d{1,2})(?!\d))?/;
const LEGACY_NAMING_PATTERN = /claude-(?:[123](?:[-.]\d)?-(?:opus|sonnet|haiku)|[12](?![\d])|instant)/;

function parseClaudeVersion(modelId: string): ClaudeVersion | undefined {
	const match = FAMILY_VERSION_PATTERN.exec(modelId.toLowerCase());
	if (!match) return undefined;
	return { family: match[1]!, major: Number(match[2]), minor: match[3] ? Number(match[3]) : 0 };
}

function isAtLeast4_6(version: ClaudeVersion): boolean {
	return version.major > 4 || (version.major === 4 && version.minor >= 6);
}

export function supportsClaudeAdaptiveThinking(modelId: string): boolean {
	const id = modelId.toLowerCase();
	if (LEGACY_NAMING_PATTERN.test(id)) return false;
	const version = parseClaudeVersion(id);
	if (version) return isAtLeast4_6(version);
	return id.includes("claude");
}

export function supportsClaudeMaxEffort(modelId: string): boolean {
	const version = parseClaudeVersion(modelId);
	return version?.family === "opus" && isAtLeast4_6(version);
}

export function mapClaudeThinkingLevelToEffort(level: SimpleStreamOptions["reasoning"], modelId: string): ClaudeEffort {
	switch (level) {
		case "minimal":
		case "low":
			return "low";
		case "medium":
			return "medium";
		case "high":
			return "high";
		case "xhigh":
			return supportsClaudeMaxEffort(modelId) ? "max" : "high";
		default:
			return "high";
	}
}
