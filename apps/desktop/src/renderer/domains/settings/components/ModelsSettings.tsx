import { ModelsSettingsView } from "./ModelsSettingsView";
import { useModelsSettingsModel } from "./useModelsSettingsModel";
import { useImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";
export { InputField, SelectField } from "./SettingsFormFields";

export function ModelsSettings(): JSX.Element {
	const model = useModelsSettingsModel();
	const imageGeneration = useImageGenerationSettingsModel();
	return <ModelsSettingsView model={model} imageGeneration={imageGeneration} />;
}
