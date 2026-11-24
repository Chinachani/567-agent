import { ImBridgeSettingsView } from "./ImBridgeSettingsView";
import { WebhookSettingsSection } from "./WebhookSettingsView";
import { useImBridgeSettingsModel } from "./useImBridgeSettingsModel";
import { useWebhookSettingsModel } from "./useWebhookSettingsModel";

export function ImBridgeSettings(): JSX.Element {
	const model = useImBridgeSettingsModel();
	const webhookModel = useWebhookSettingsModel();
	return (
		<ImBridgeSettingsView model={model}>
			<WebhookSettingsSection model={webhookModel} showDescription showAiAssist />
		</ImBridgeSettingsView>
	);
}
