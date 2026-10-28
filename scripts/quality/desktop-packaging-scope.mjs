import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { changedFiles } from "./lib.mjs";

const PACKAGED_SMOKE_PATTERNS = [
	/^packages\/plugins\/presets\/vetta-ui-design\/(src|engine)\//,
	/^apps\/desktop\/scripts\/(test-canvas-gestures\.mjs|fixtures\/canvas-gestures\.jsx)$/,
	/^packages\/theme-ui\/src\/chat\/TaskProgressView\.tsx$/,
	/^apps\/desktop\/src\/renderer\/domains\/conversation\/(components\/SessionTaskProgress\.tsx|hooks\/useTaskProgressModel\.ts)$/,
	/^packages\/theme-ui\/src\/settings\/(GeneralSettingsView|ArchivedProjectsSettingsView|AppshotSettingsView|ShortcutsSettingsView|EnvironmentSettingsView|PermissionsSettingsView)\.tsx$/,
	/^apps\/desktop\/src\/renderer\/domains\/settings\/components\/(RemotePairingSettings|AgentSettingsView|KnowledgeBaseSettingsView|ImBridgeSettingsView|ExtensionsSettingsView|GeneralSettings|AppearanceSettingsView|AccountSettingsView)\.tsx$/,
	/^apps\/desktop\/scripts\/fixtures\/workspace-redesign\.jsx$/,
	/^packages\/theme-ui\/src\/(shared\/WorkspacePageHeader|layout\/MainContentFrame|sidebar\/(SidebarPanel|SidebarNavigation|SidebarNavItemButton)|settings\/(SettingsPageShellView|SettingsSidebarView)|scheduler\/(AutomationPageView|TaskListView)|batch-tasks\/BatchTasksPageView|skills\/SkillTagGroupView|chat\/(MessageInputView|NewSessionPageLayoutView|GuideBadgeSwiperView|MessageLayoutView|MessageVisualView|ToolCallBlockView))\.tsx$/,
	/^apps\/desktop\/src\/renderer\/(domains\/(conversation\/components\/(input-bar\/InputBarView|new-session\/NewSessionHero)|abilities\/components\/(AbilitiesPageView|AbilityCard|AbilitiesBanner|AddAbilityMenu)|skills\/components\/SkillsPageView|knowledge-base\/components\/KnowledgeBaseListPageView)|shared\/theme\/themes\/mono)\.tsx?$/,
	/^apps\/desktop\/scripts\/bundle-agent-rpc\.(mjs|d\.mts|test\.ts)$/,
	/^apps\/desktop\/scripts\/test-(capture-portal|wayland-input-bundle|sidebar-account-layout|workspace-layout)\.mjs$/,
	/^apps\/desktop\/src\/renderer\/(domains\/api567\/components\/Api567AccountDialog\.tsx|domains\/project\/components\/sidebar\/(SidebarBottomBar|SidebarAccountMenu|settings-menu\/SettingsMenuDialog)\.tsx|styles\.css)$/,
	/^apps\/desktop\/src\/renderer\/shared\/app-shell\/(page-header|window-controls)\//,
	/^apps\/desktop\/src\/renderer\/domains\/(settings\/components\/(GeneralSettings(?:View)?|SessionMigrationSettings|ModelsProvider(?:sSection|Row)|SettingsListSearch)|setup-wizard\/components\/FeatureGuide)\.tsx$/,
	/^packages\/theme-ui\/src\/app-shell\//,
	/^packages\/theme-ui\/src\/settings\/(GeneralSettingsView|SettingChrome|ModelsProvidersSectionView)\.tsx$/,
	/^packages\/theme-ui\/src\/(sidebar\/(SettingsMenuTriggerView|MessageCenterDialogView)|project\/ProjectsPanelView)\.tsx$/,
	/^apps\/desktop\/(build\/installer\.|scripts\/(build-inno-installer|inno-installer-process|verify-inno-))/,
	/^apps\/desktop\/(src\/main|src\/preload|scripts\/(prepare-pack\.js|desktop-build-environment\.mjs|mac-signing-config\.mjs|run-open-source-build\.mjs)|scripts\/desktop-packaging-layout\.mjs|scripts\/packaged-native-dependencies\.|vite\..*config\.|package\.json|wdio\.conf\.ts|e2e\/)/,
	/^packages\/(remote-control|remote-desktop)\//,
	/^bun\.lock$/,
	/^\.github\/workflows\/(quality|desktop-packaged)\.yml$/,
];

export function classifyDesktopPackagingRisk(paths) {
	const normalized = paths.map((path) => path.replaceAll("\\", "/"));
	const reasons = normalized.filter((path) => PACKAGED_SMOKE_PATTERNS.some((pattern) => pattern.test(path)));
	return {
		packagedSmokeRequired: reasons.length > 0,
		reasons: [...new Set(reasons)].sort(),
	};
}

function resolveBaseRef() {
	if (process.env.DESKTOP_PACKAGING_BASE_REF) return process.env.DESKTOP_PACKAGING_BASE_REF;
	if (process.env.GITHUB_EVENT_NAME === "pull_request" && process.env.GITHUB_BASE_REF) {
		return `origin/${process.env.GITHUB_BASE_REF}`;
	}
	if (
		process.env.GITHUB_EVENT_NAME === "push" &&
		process.env.GITHUB_EVENT_BEFORE &&
		!/^[0]+$/.test(process.env.GITHUB_EVENT_BEFORE)
	) {
		return process.env.GITHUB_EVENT_BEFORE;
	}
	if (process.env.GITHUB_SHA) return `${process.env.GITHUB_SHA}^`;
	return "origin/dev";
}

export function writeDesktopPackagingScopeOutput(result, outputPath = process.env.GITHUB_OUTPUT) {
	if (!outputPath) return;
	appendFileSync(outputPath, `packaged-smoke=${result.packagedSmokeRequired}\n`);
}

export function main() {
	const result = classifyDesktopPackagingRisk(changedFiles(resolveBaseRef()));
	console.log(
		`[desktop-packaging-scope] packaged smoke: ${result.packagedSmokeRequired ? "required" : "not required"}`,
	);
	if (result.reasons.length > 0) console.log(`[desktop-packaging-scope] reasons:\n${result.reasons.join("\n")}`);
	writeDesktopPackagingScopeOutput(result);
	return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
