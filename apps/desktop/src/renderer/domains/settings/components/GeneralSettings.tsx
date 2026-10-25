import { FeatureGuide } from "@domains/setup-wizard";
import { Button } from "@shared/components/ui/button";
import { SettingRow, SettingSection } from "@vetta-org/theme-ui/settings";
import { useTranslation } from "react-i18next";
import { GeneralSettingsView } from "./GeneralSettingsView";
import { SessionMigrationSettings } from "./SessionMigrationSettings";
import { useGeneralSettingsModel } from "./useGeneralSettingsModel";

export function GeneralSettings(): JSX.Element {
	const model = useGeneralSettingsModel();
	const { t } = useTranslation("common");
	return (
		<div className="mx-auto w-full min-w-0 max-w-[800px] px-5 pt-6 pb-4 sm:px-8">
			<GeneralSettingsView model={model} />
			<section aria-labelledby="general-help">
				<SettingSection section={{ id: "general-help" }} title={t("featureGuide.helpTitle")}>
					<SettingRow title={t("featureGuide.title")} description={t("featureGuide.settingsDescription")}>
						<FeatureGuide />
					</SettingRow>
					<SettingRow
						title={model.labels.startAppGuide}
						description={model.labels.startAppGuideDescription}
						border={false}
					>
						<Button size="sm" variant="outline" onClick={model.actions.startAppGuide}>
							{model.labels.startAppGuideAction}
						</Button>
					</SettingRow>
				</SettingSection>
			</section>
			<SessionMigrationSettings />
		</div>
	);
}
