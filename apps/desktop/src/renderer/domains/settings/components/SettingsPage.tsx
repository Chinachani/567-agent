import { PluginWorkspaceViewSurface } from "@domains/plugins/components/PluginWorkspaceViewRoute";
import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import type { SettingsTab } from "@shared/store/atoms";
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { BrowserConnectionSettings } from "./BrowserConnectionSettings";
import { SettingsPageView } from "./SettingsPageView";
import { SETTINGS_TAB_LOADERS } from "./settings-tab-loaders";
import { useSettingsPageModel } from "./useSettingsPageModel";
import "./settings-highlight.css";

/** MCP 已迁至扩展 → 连接器；`mcp` 保留在 SettingsTab 供 analytics / 旧链接重定向，此处不渲染。 */
const SETTINGS_CONTENT: Record<Exclude<SettingsTab, "mcp">, LazyExoticComponent<ComponentType>> = {
	sshHosts: lazy(SETTINGS_TAB_LOADERS.sshHosts),
	general: lazy(SETTINGS_TAB_LOADERS.general),
	appearance: lazy(SETTINGS_TAB_LOADERS.appearance),
	account: lazy(SETTINGS_TAB_LOADERS.account),
	models: lazy(SETTINGS_TAB_LOADERS.models),
	environment: lazy(SETTINGS_TAB_LOADERS.environment),
	extensions: lazy(SETTINGS_TAB_LOADERS.extensions),
	permissions: lazy(SETTINGS_TAB_LOADERS.permissions),
	im: lazy(SETTINGS_TAB_LOADERS.im),
	webhook: lazy(SETTINGS_TAB_LOADERS.webhook),
	shortcuts: lazy(SETTINGS_TAB_LOADERS.shortcuts),
	appshot: lazy(SETTINGS_TAB_LOADERS.appshot),
	archive: lazy(SETTINGS_TAB_LOADERS.archive),
	team: lazy(SETTINGS_TAB_LOADERS.team),
	context: lazy(SETTINGS_TAB_LOADERS.context),
	knowledge: lazy(SETTINGS_TAB_LOADERS.knowledge),
	remote: lazy(SETTINGS_TAB_LOADERS.remote),
};

export function SettingsPage(): JSX.Element {
	const model = useSettingsPageModel();
	const contentSurface = useThemeSurface("settings.pageContent");
	const Content = model.activeTab === "mcp" ? SETTINGS_CONTENT.general : SETTINGS_CONTENT[model.activeTab];

	const activeTab = model.activeTab === "mcp" ? "general" : model.activeTab;
	const embedded = model.embeddedView;
	const isBrowserConsole = embedded?.pluginId === "browser" && embedded?.viewId === "console";

	// 内嵌的插件视图是整页 surface：给它完整宽高，不套设置页的居中窄栏。
	// 找不到该视图时退回通用设置，避免留下不可用的插件入口。
	const content = embedded ? (
		isBrowserConsole ? (
			<div className="mx-auto w-full min-w-0 max-w-[800px] px-5 pt-6 pb-8 sm:px-8">
				<BrowserConnectionSettings />
					<div className="[&_.browser-page]:h-auto [&_.browser-page]:overflow-visible [&_.browser-page-inner]:max-w-none [&_.browser-page-inner]:gap-5 [&_.browser-page-inner]:px-0 [&_.browser-page-inner]:pt-4 [&_.browser-page-inner]:pb-0 [&_[data-browser-extension]]:hidden [&_[data-browser-hero]]:hidden">
					<PluginWorkspaceViewSurface
						key={`${embedded.pluginId}:${embedded.viewId}`}
						pluginId={embedded.pluginId}
						viewId={embedded.viewId}
						onMissing={model.onCloseEmbeddedView}
					/>
				</div>
			</div>
		) : (
			<PluginWorkspaceViewSurface
				key={`${embedded.pluginId}:${embedded.viewId}`}
				pluginId={embedded.pluginId}
				viewId={embedded.viewId}
				onMissing={model.onCloseEmbeddedView}
			/>
		)
	) : (
		<Suspense fallback={null}>
			{/* key=tab：切换侧栏时重挂载，避免不同 tab 复用同一组件实例的残留状态 */}
			<div key={activeTab} className="w-full min-h-0">
				<Content />
			</div>
		</Suspense>
	);

	return (
		<SettingsPageView
			content={content}
			contentSurfaceRootClassName={contentSurface?.rootClassName}
			fillContent={Boolean(embedded) && !isBrowserConsole}
			model={model}
		/>
	);
}
