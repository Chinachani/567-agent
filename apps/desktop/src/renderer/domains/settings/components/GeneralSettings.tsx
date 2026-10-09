import { GeneralSettingsView } from "./GeneralSettingsView";
import { SessionMigrationSettings } from "./SessionMigrationSettings";
import { useGeneralSettingsModel } from "./useGeneralSettingsModel";

export function GeneralSettings(): JSX.Element {
	return (
		<>
			<GeneralSettingsView model={useGeneralSettingsModel()} />
			<SessionMigrationSettings />
		</>
	);
}
