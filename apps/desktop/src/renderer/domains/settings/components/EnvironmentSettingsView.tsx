import { EnvironmentSettingsView as ThemeEnvironmentSettingsView } from "@vetta-org/theme-ui/settings";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import type { EnvironmentSettingsModel } from "./useEnvironmentSettingsModel";

export interface EnvironmentSettingsViewProps {
	model: EnvironmentSettingsModel;
}

export function EnvironmentSettingsView({ model }: EnvironmentSettingsViewProps): JSX.Element {
	return (
		<ThemeEnvironmentSettingsView
			busy={model.busy}
			error={model.error}
			progress={model.progress}
			logs={model.logs}
			git={{
				...model.git,
				onCopyCommand: (command) => void model.actions.copyGitCommand(command),
				onInstall: () => void model.actions.installGit(),
				onOpenDownload: model.actions.openGitDownload,
				onRedetect: () => void model.actions.redetect(),
			}}
			headerAction={<SettingsAiAssist tabId="environment" />}
			labels={model.labels}
			mirrors={model.status?.mirrors ?? null}
			mirrorsSection={SETTINGS_SECTION["environment-mirrors"]}
			runtimeSection={SETTINGS_SECTION["environment-runtime"]}
			toolsSection={SETTINGS_SECTION["environment-tools"]}
			status={model.status}
			onReinstall={(kind) => void model.actions.reinstall(kind)}
		/>
	);
}
