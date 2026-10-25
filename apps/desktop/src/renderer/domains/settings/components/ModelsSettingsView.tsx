import { useTranslation } from "react-i18next";
import { SettingsPageShellView } from "@vetta-org/theme-ui/settings";
import { SettingsAiAssist } from "../ai-assist";
import { Api567GroupsSection } from "./Api567GroupsSection";
import { ModelContextSettings } from "./ModelContextSettings";
import { ModelsProvidersSection } from "./ModelsProvidersSection";
import type { ModelsSettingsModel } from "./useModelsSettingsModel";
import type { ImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";
import { ImageGenerationSettingsSection } from "./ImageGenerationSettingsSection";

export function ModelsSettingsView({
	model,
	imageGeneration,
}: {
	model: ModelsSettingsModel;
	imageGeneration: ImageGenerationSettingsModel;
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
					<Api567GroupsSection config={model.config} />
					<ImageGenerationSettingsSection model={imageGeneration} />
					<ModelContextSettings config={model.config} />
					<ModelsProvidersSection model={model} />
				</>
			)}
		</SettingsPageShellView>
	);
}
