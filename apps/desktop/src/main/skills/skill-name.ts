const SKILL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Validate names before using them in filesystem paths or process arguments. */
export function assertValidSkillName(value: unknown): asserts value is string {
	if (typeof value !== "string" || !SKILL_NAME_PATTERN.test(value)) {
		throw new Error("Invalid skill name: expected 1-64 letters, numbers, underscores, or hyphens");
	}
}
