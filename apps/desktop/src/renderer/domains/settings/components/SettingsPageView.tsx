import { SettingsContent } from "./SettingsContent";
import { SettingsSidebar } from "./SettingsSidebar";
import type { SettingsPageModel } from "./types";

export interface SettingsPageViewProps {
	content: React.ReactNode;
	contentSurfaceRootClassName?: string;
	/** 内容自己占满内容区（内嵌插件工作区视图）。 */
	fillContent?: boolean;
	model: SettingsPageModel;
}

export function SettingsPageView({
	content,
	contentSurfaceRootClassName,
	fillContent = false,
	model,
}: SettingsPageViewProps): JSX.Element {
	return (
		<div className="relative flex min-h-0 w-full flex-1 overflow-hidden">
			<SettingsSidebar model={model} />
			<SettingsContent fill={fillContent} rootClassName={contentSurfaceRootClassName}>
				{content}
			</SettingsContent>
		</div>
	);
}
