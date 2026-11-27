import { useThemeRegion } from "@vetta-org/theme-sdk";
import { usePageHeaderModel } from "@vetta-org/theme-sdk/app-shell";
import { DefaultPageHeader } from "@vetta-org/theme-ui/app-shell";
import { WindowControls } from "@shared/app-shell/window-controls";
import { MessageCenter } from "@domains/project/components/sidebar/message-center/MessageCenter";
import type { PageHeaderProps } from "./types";

export { DefaultPageHeader } from "@vetta-org/theme-ui/app-shell";

export function PageHeader(props: PageHeaderProps): JSX.Element {
	const model = usePageHeaderModel(props);
	const pageModel = {
		...model,
		rightSlot: (
			<>
				{model.rightSlot}
				<MessageCenter />
			</>
		),
	};
	const ThemePageHeader = useThemeRegion("app.pageHeader");
	if (ThemePageHeader) {
		return <ThemePageHeader {...props} model={pageModel} />;
	}
	return <DefaultPageHeader {...props} model={pageModel} windowControls={<WindowControls />} />;
}
