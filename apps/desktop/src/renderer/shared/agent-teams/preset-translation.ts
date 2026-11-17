import type { AgentResourceSource } from "@567agent/agent-team";

/** Prefer an exact locale, then its language, then a stable regional variant. */
export function presetTranslation(source: AgentResourceSource, locale: string) {
	const entries = Object.entries(source.translations ?? {});
	const requested = locale.toLowerCase();
	const language = requested.split("-")[0];
	return (entries.find(([key]) => key.toLowerCase() === requested) ??
		entries.find(([key]) => key.toLowerCase() === language) ??
		entries
			.filter(([key]) => key.toLowerCase().split("-")[0] === language)
			.sort(([a], [b]) => a.localeCompare(b))[0])?.[1];
}
