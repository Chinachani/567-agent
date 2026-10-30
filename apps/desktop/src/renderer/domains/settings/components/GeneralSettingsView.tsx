import { useUpdateCheckerModel } from "@shared/hooks/useUpdateCheckerModel";
import { UpdateCheckerActions, UpdateDownloadProgress } from "@vetta-org/theme-ui/overlays";
import { GeneralSettingsView as ThemeGeneralSettingsView } from "@vetta-org/theme-ui/settings";
import { useState } from "react";
import { SETTINGS_SECTION } from "../registry";
import { DiagnosticsDialog } from "./DiagnosticsDialog";
import { UpdatePreferencesSettings } from "./UpdatePreferencesSettings";
import type { GeneralSettingsModel } from "./useGeneralSettingsModel";

export interface GeneralSettingsViewProps {
	model: GeneralSettingsModel;
}

/** Thin host adapter: model + updater pieces for SettingRow (no components/ui host chrome). */
export function GeneralSettingsView({ model }: GeneralSettingsViewProps): JSX.Element {
	const updates = useUpdateCheckerModel();
	const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
	const showUpdateDetail = updates.phase === "downloading";

	return (
		<>
			<ThemeGeneralSettingsView
				labels={model.labels}
				sections={{
					basics: SETTINGS_SECTION["general-basics"],
					app: SETTINGS_SECTION["general-app"],
					developer: SETTINGS_SECTION["general-developer"],
				}}
				workspacePath={model.workspacePath}
				updateSource={model.updateSource}
				onUpdateSourceChange={(source) => void model.actions.setUpdateSource(source)}
				updateProxyUrl={model.updateProxyUrl}
				updateProxyUrlValid={model.updateProxyUrlValid}
				updateSourceSaveState={model.updateSourceSaveState}
				onUpdateProxyUrlChange={model.actions.setUpdateProxyUrl}
				onSaveUpdateProxyUrl={() => void model.actions.saveUpdateProxyUrl()}
				onSelectWorkspace={() => void model.actions.selectWorkspace()}
				onResetWorkspace={() => void model.actions.resetWorkspace()}
				updatesDescription={updates.statusText}
				updatesAction={
					<UpdateCheckerActions
						checking={updates.checking}
						labels={updates.labels}
						onCheck={updates.onCheck}
						onPrimary={updates.onPrimary}
						onPause={updates.onPause}
						phase={updates.phase}
						currentVersion={updates.currentVersion}
					/>
				}
				updatesDetail={
					showUpdateDetail ? (
						<UpdateDownloadProgress
							progress={updates.progress}
							label={updates.labels.downloading(Math.round((updates.progress ?? 0) * 100))}
						/>
					) : null
				}
				executionMode={model.executionMode}
				onExecutionModeChange={(mode) => void model.actions.changeExecutionMode(mode)}
				sandboxUnavailableReason={model.sandboxUnavailableReason}
				notificationsEnabled={model.notificationsEnabled}
				onNotificationsChange={model.actions.toggleNotifications}
				debugMode={model.debugMode}
				onDebugChange={model.actions.toggleDebug}
				exportingDiagnostics={false}
				onExportDiagnostics={() => setDiagnosticsOpen(true)}
			>
				<UpdatePreferencesSettings />
			</ThemeGeneralSettingsView>
			<DiagnosticsDialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen} />
		</>
	);
}
