import { BrowserConnectionSettingsView } from "@vetta-org/theme-ui/settings";
import { useBrowserConnectionSettingsModel } from "./useBrowserConnectionSettingsModel";

export function BrowserConnectionSettings(): JSX.Element {
	return <BrowserConnectionSettingsView model={useBrowserConnectionSettingsModel()} />;
}
