import { AgentSettingsView } from "./AgentSettingsView";
import { useAgentSettingsModel } from "./useAgentSettingsModel";
import { useRuntimeConfigurationModel } from "./useRuntimeConfigurationModel";
import { useModelCallLimitSettingsModel } from "./useModelCallLimitSettingsModel";

export function AgentSettings(): JSX.Element {
	return (
		<AgentSettingsView
			model={useAgentSettingsModel()}
			runtimeConfiguration={useRuntimeConfigurationModel()}
			modelCallLimit={useModelCallLimitSettingsModel()}
		/>
	);
}
