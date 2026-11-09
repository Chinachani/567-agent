import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { isModelSettingsSource, modelSettingsSourceForSection } from "./model-settings-source";

export function useModelsSettingsTabs(ready: boolean) {
	const search = useSearch({ strict: false });
	const navigate = useNavigate();
	const section = search.section ?? search.h2;
	const value =
		modelSettingsSourceForSection(section) ??
		(isModelSettingsSource(search.modelSource) ? search.modelSource : "api567");

	// Section links can arrive before the model configuration, or target a panel not yet visited.
	useEffect(() => {
		const section = search.section ?? search.h2;
		if (!ready || !section) return;
		const frame = requestAnimationFrame(() => {
			document.getElementById(section)?.scrollIntoView({ block: "start" });
		});
		return () => cancelAnimationFrame(frame);
	}, [ready, search]);

	return {
		value,
		onValueChange: (next: string) => {
			if (!isModelSettingsSource(next)) return;
			void navigate({
				to: "/settings/$tab",
				params: { tab: "models" },
				search: { modelSource: next },
				replace: true,
				resetScroll: false,
			});
		},
	};
}

export type ModelsSettingsTabsModel = ReturnType<typeof useModelsSettingsTabs>;
