import { SettingsPageShellView, SettingSection } from "@vetta-org/theme-ui/settings";
import { Button } from "@vetta-org/ui";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { WebhookEditorDialog } from "./WebhookEditorDialog";
import { WebhookEndpointList } from "./WebhookEndpointList";
import type { WebhookSettingsModel } from "./useWebhookSettingsModel";

export function WebhookSettingsSection({
	model,
	showDescription = false,
	showAiAssist = false,
}: {
	model: WebhookSettingsModel;
	showDescription?: boolean;
	showAiAssist?: boolean;
}): JSX.Element {
	return (
		<SettingSection
			section={SETTINGS_SECTION["webhook-channels"]}
			description={showDescription ? model.labels.description : undefined}
			title={
				<div className="flex flex-wrap items-center justify-between gap-2">
					<span>{showDescription ? model.labels.title : model.labels.channels}</span>
					<div className="flex flex-wrap items-center gap-2">
						{showAiAssist && !model.loading && <SettingsAiAssist tabId="webhook" />}
						<Button size="sm" variant="primary" onClick={model.actions.openCreate} disabled={model.loading}>
							<span aria-hidden="true" className="icon-[mdi--plus] h-4 w-4" />
							{model.labels.add}
						</Button>
					</div>
				</div>
			}
		>
			{model.loading ? (
				<div role="status" className="flex items-center gap-3 px-4 py-6 text-[13px] text-muted-foreground">
					<span aria-hidden="true" className="icon-[solar--refresh-linear] h-4 w-4 animate-spin" />
					{model.labels.loading}
				</div>
			) : (
				<WebhookEndpointList model={model} />
			)}
			<WebhookEditorDialog model={model} />
		</SettingSection>
	);
}

export function WebhookSettingsView({ model }: { model: WebhookSettingsModel }): JSX.Element {
	return (
		<SettingsPageShellView
			title={model.labels.title}
			description={model.loading ? undefined : model.labels.description}
			headerAction={model.loading ? undefined : <SettingsAiAssist tabId="webhook" />}
			loading={model.loading}
			loadingLabel={model.labels.loading}
		>
			{!model.loading && (
				<WebhookSettingsSection model={model} />
			)}
		</SettingsPageShellView>
	);
}
