import type { ModelsConfigData } from "@preload/api-types/models";
import { getBuiltinApi567Route } from "../../../../shared/service-routes";

export type ModelSettingsSource = "api567" | "presets" | "local";

export function isModelSettingsSource(value: unknown): value is ModelSettingsSource {
	return value === "api567" || value === "presets" || value === "local";
}

export function modelSettingsSourceForSection(section: unknown): ModelSettingsSource | undefined {
	if (section === "models-api567") return "api567";
	if (section === "models-preset-providers") return "presets";
	if (section === "models-providers") return "local";
	return undefined;
}

/** Match the managed endpoint as well as its name so custom lookalikes stay editable. */
export function groupModelSettingsProviders(
	config: ModelsConfigData | null,
	trustedOrigins: readonly string[],
): Record<ModelSettingsSource, string[]> {
	const groups: Record<ModelSettingsSource, string[]> = { api567: [], presets: [], local: [] };
	for (const [name, provider] of Object.entries(config?.providers ?? {})) {
		const id = name.toLowerCase();
		const displayName = provider.displayName?.trim().toLowerCase() ?? "";
		const managed =
			getBuiltinApi567Route(provider.baseUrl, trustedOrigins) !== undefined &&
			(id === "567api" || id.startsWith("567api_") || displayName === "567 api" || displayName.startsWith("567 ·"));
		groups[managed ? "api567" : provider.source === "template" ? "presets" : "local"].push(name);
	}
	return groups;
}
