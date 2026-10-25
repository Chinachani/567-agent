import { describe, expect, it } from "vitest";
import { classifyDesktopPackagingRisk } from "./desktop-packaging-scope.mjs";

describe("Desktop packaging risk classification", () => {
	it("requires native packaging coverage for installer and migration changes", () => {
		const paths = [
			"apps/desktop/build/installer.iss",
			"apps/desktop/build/installer.zh-cn.isl",
			"apps/desktop/scripts/build-inno-installer.mjs",
			"apps/desktop/scripts/inno-installer-process.mjs",
			"apps/desktop/scripts/verify-inno-install.mjs",
			"apps/desktop/scripts/verify-inno-update.mjs",
		];
		expect(classifyDesktopPackagingRisk(paths)).toEqual({ packagedSmokeRequired: true, reasons: paths.sort() });
	});
	it("requires packaged smoke for main, preload, packaging and remote changes", () => {
		const result = classifyDesktopPackagingRisk([
			"apps/desktop/src/main/remote-control/desktop-remote-pairing-service.ts",
			"apps/desktop/src/preload/api-types/remote-pairing.ts",
			"apps/desktop/scripts/prepare-pack.js",
			"apps/desktop/scripts/desktop-build-environment.mjs",
			"apps/desktop/scripts/bundle-agent-rpc.mjs",
			"apps/desktop/scripts/bundle-agent-rpc.test.ts",
			"packages/remote-control/src/index.ts",
		]);
		expect(result.packagedSmokeRequired).toBe(true);
		expect(result.reasons).toHaveLength(7);
	});

	it("requires the Linux native probe job when either probe changes", () => {
		for (const path of [
			"apps/desktop/scripts/test-capture-portal.mjs",
			"apps/desktop/scripts/test-wayland-input-bundle.mjs",
			"apps/desktop/scripts/test-sidebar-account-layout.mjs",
			"apps/desktop/scripts/test-workspace-layout.mjs",
			"apps/desktop/scripts/fixtures/workspace-redesign.jsx",
			"packages/theme-ui/src/shared/WorkspacePageHeader.tsx",
			"packages/theme-ui/src/scheduler/TaskListView.tsx",
			"apps/desktop/src/renderer/domains/conversation/components/input-bar/InputBarView.tsx",
			"apps/desktop/src/renderer/domains/api567/components/Api567AccountDialog.tsx",
			"apps/desktop/src/renderer/domains/project/components/sidebar/SidebarBottomBar.tsx",
			"apps/desktop/src/renderer/styles.css",
			"apps/desktop/src/renderer/shared/app-shell/page-header/PageHeader.tsx",
			"apps/desktop/src/renderer/shared/app-shell/window-controls/useWindowControlsModel.ts",
			"packages/theme-ui/src/app-shell/DefaultWindowControls.tsx",
			"packages/theme-ui/src/app-shell/WindowControlButton.tsx",
			"apps/desktop/src/renderer/domains/settings/components/GeneralSettings.tsx",
			"apps/desktop/src/renderer/domains/settings/components/GeneralSettingsView.tsx",
			"apps/desktop/src/renderer/domains/settings/components/SessionMigrationSettings.tsx",
			"apps/desktop/src/renderer/domains/setup-wizard/components/FeatureGuide.tsx",
			"packages/theme-ui/src/settings/GeneralSettingsView.tsx",
			"packages/theme-ui/src/sidebar/SettingsMenuTriggerView.tsx",
			"packages/theme-ui/src/sidebar/MessageCenterDialogView.tsx",
			"packages/theme-ui/src/settings/ModelsProvidersSectionView.tsx",
			"apps/desktop/src/renderer/domains/settings/components/ModelsProvidersSection.tsx",
			"apps/desktop/src/renderer/domains/settings/components/ModelsProviderRow.tsx",
			"apps/desktop/src/renderer/domains/settings/components/SettingsListSearch.tsx",
			"apps/desktop/src/renderer/domains/project/components/sidebar/SidebarAccountMenu.tsx",
			"apps/desktop/src/renderer/domains/project/components/sidebar/settings-menu/SettingsMenuDialog.tsx",
			"packages/theme-ui/src/project/ProjectsPanelView.tsx",
		]) {
			expect(classifyDesktopPackagingRisk([path]).packagedSmokeRequired).toBe(true);
		}
	});

	it("does not require packaged smoke for unrelated renderer work", () => {
		const result = classifyDesktopPackagingRisk(["apps/desktop/src/renderer/domains/conversation/ChatPage.tsx"]);
		expect(result).toEqual({ packagedSmokeRequired: false, reasons: [] });
	});

	it("normalizes Windows paths and removes duplicate reasons", () => {
		const result = classifyDesktopPackagingRisk([
			"apps\\desktop\\src\\main\\main.ts",
			"apps/desktop/src/main/main.ts",
		]);
		expect(result).toEqual({ packagedSmokeRequired: true, reasons: ["apps/desktop/src/main/main.ts"] });
	});
});
