import { PresetProvidersSectionView } from "./PresetProvidersSectionView";
import type { PresetProvidersSectionModel } from "./usePresetProvidersSectionModel";
import { useTranslation } from "react-i18next";
import { SettingsPageShellView } from "@vetta-org/theme-ui/settings";
import { SettingsAiAssist } from "../ai-assist";
import { Api567GroupsSection } from "./Api567GroupsSection";
import { ModelContextSettings } from "./ModelContextSettings";
import { ModelsProvidersSection } from "./ModelsProvidersSection";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";
import type { ImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";
import { ImageGenerationSettingsSection } from "./ImageGenerationSettingsSection";
import { Tabs } from "radix-ui";
import { useEffect, useState, type ReactNode } from "react";
import type { ModelSettingsSource } from "./model-settings-source";
import type { ModelsSettingsTabsModel } from "./useModelsSettingsTabs";

const SOURCE_TAB_CLASS =
	"min-w-0 flex-1 rounded-lg px-2 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:ring-1 data-[state=active]:ring-inset data-[state=active]:ring-border/60";

export function ModelsSettingsView({
	model,
	presets,
	imageGeneration,
	tabs,
}: {
	model: ModelsSettingsModel;
	presets: PresetProvidersSectionModel;
	imageGeneration: ImageGenerationSettingsModel;
	tabs: ModelsSettingsTabsModel;
}): JSX.Element {
	const { t } = useTranslation("settings");

	return (
		<SettingsPageShellView
			title={model.config ? t("modelSettings.title") : t("modelsTitle")}
			headerAction={model.config ? <SettingsAiAssist tabId="models" /> : undefined}
			loading={!model.config}
			loadingLabel={t("loading")}
			footer={
				model.config ? (
					<div className="mt-6 text-center text-[11px] text-muted-foreground/60">
						{t("configFilePath")}: ~/.567agent/agent/models.json
					</div>
				) : undefined
			}
		>
			{model.config && (
				<>
					<Tabs.Root value={tabs.value} onValueChange={tabs.onValueChange}>
						<Tabs.List
							aria-label={t("modelSettings.sources.label")}
							className="mb-6 flex w-full gap-1 rounded-xl bg-muted/60 p-1"
						>
							<Tabs.Trigger value="api567" className={SOURCE_TAB_CLASS}>
								{t("modelSettings.sources.api567")}
							</Tabs.Trigger>
							<Tabs.Trigger value="presets" className={SOURCE_TAB_CLASS}>
								{t("presetProviders")}
							</Tabs.Trigger>
							<Tabs.Trigger value="local" className={SOURCE_TAB_CLASS}>
								{t("localProviders")}
							</Tabs.Trigger>
						</Tabs.List>
						<SourcePanel value="api567" active={tabs.value}>
							<Api567GroupsSection config={model.config} />
							<ModelContextSettings
								config={model.config}
								providerIds={model.providerIdsBySource.api567}
								emptyLabel={t("modelSettings.sources.api567Empty")}
							/>
						</SourcePanel>
						<SourcePanel value="presets" active={tabs.value}>
							<PresetProvidersSectionView model={presets} />
							<ModelContextSettings
								config={model.config}
								providerIds={model.providerIdsBySource.presets}
								emptyLabel={t("modelSettings.sources.presetsEmpty")}
							/>
						</SourcePanel>
						<SourcePanel value="local" active={tabs.value}>
							<ModelsProvidersSection model={model} />
							<ModelContextSettings
								config={model.config}
								providerIds={model.providerIdsBySource.local}
								emptyLabel={t("modelSettings.sources.localEmpty")}
							/>
						</SourcePanel>
					</Tabs.Root>
					<div className="mt-8 border-t border-border/60 pt-2">
						<ImageGenerationSettingsSection model={imageGeneration} />
					</div>
				</>
			)}
		</SettingsPageShellView>
	);
}

/** Keep each visited editor mounted so switching sources preserves selections and unsaved drafts. */
function SourcePanel({
	value,
	active,
	children,
}: {
	value: ModelSettingsSource;
	active: ModelSettingsSource;
	children: ReactNode;
}): JSX.Element {
	const [visited, setVisited] = useState(active === value);
	useEffect(() => {
		if (active === value) setVisited(true);
	}, [active, value]);
	return (
		<Tabs.Content
			value={value}
			forceMount
			hidden={active !== value}
			className="min-w-0 rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
		>
			{(visited || active === value) && children}
		</Tabs.Content>
	);
}
