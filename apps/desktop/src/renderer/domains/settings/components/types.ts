import type { SettingsTab } from "@shared/store/atoms";
import type { SettingsSidebarTabItem } from "@vetta-org/theme-ui/settings";

export type SettingsNavigationItem = SettingsSidebarTabItem;

export interface SettingsPageModel {
	activeTab: SettingsTab;
	activeNavigationKey: string;
	betaBadgeLabel: string;
	narrow: boolean;
	onSelectNavigation: (key: string) => void;
	tabs: readonly SettingsNavigationItem[];
	/** Plugin content retains its original URL and configuration ownership. */
	embeddedView?: { pluginId: string; viewId: string };
	onCloseEmbeddedView: () => void;
	title: string;
}
