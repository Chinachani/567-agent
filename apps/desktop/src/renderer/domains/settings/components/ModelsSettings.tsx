import { usePresetProvidersSectionModel } from "./usePresetProvidersSectionModel";
import { ModelsSettingsView } from "./ModelsSettingsView";
import { useModelsSettingsModel } from "./useModelsSettingsModel";
import { useImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";
import { useModelsSettingsTabs } from "./useModelsSettingsTabs";
export { InputField, SelectField } from "./SettingsFormFields";

export function ModelsSettings(): JSX.Element {
	const model = useModelsSettingsModel();
	const tabs = useModelsSettingsTabs(Boolean(model.config));
	const imageGeneration = useImageGenerationSettingsModel();
	const presets = usePresetProvidersSectionModel({
		config: model.config ?? { providers: {} },
		saveConfig: model.saveConfig,
	});
	return <ModelsSettingsView tabs={tabs} presets={presets} model={model} imageGeneration={imageGeneration} />;
}
