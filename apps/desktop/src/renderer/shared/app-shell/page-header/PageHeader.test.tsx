/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
	maximized: false,
	minimize: vi.fn(),
	maximize: vi.fn(),
	close: vi.fn(),
}));
vi.mock("@vetta-org/theme-sdk", async (original) => ({
	...(await original<Record<string, unknown>>()),
	useThemeRegion: () => undefined,
	useThemeComponent: (_slot: string, fallback: unknown) => fallback,
}));
vi.mock("@vetta-org/theme-sdk/appearance", async (original) => ({
	...(await original<Record<string, unknown>>()),
	useThemeSurface: () => undefined,
}));
vi.mock("@vetta-org/theme-sdk/app-shell", async () => ({
	usePageHeaderModel: () => ({ title: "Current conversation", titleHidden: false, triggerVisible: false }),
	useWindowControlsModel: (await import("../window-controls/useWindowControlsModel")).useWindowControlsModel,
}));
vi.mock("../../../domains/api567/hooks/useApi567", () => ({
	useApi567: () => ({
		status: { isLoggedIn: true, username: "Account", loginUsername: "User", quotaUsd: 21.37 },
		availableGroups: {},
	}),
}));

import { DefaultWindowControls } from "@vetta-org/theme-ui/app-shell";
import { PageHeader } from "./PageHeader";

beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});
beforeEach(() => {
	bridge.maximized = false;
	bridge.maximize.mockImplementation(async () => {
		bridge.maximized = !bridge.maximized;
	});
	Object.assign(window, {
		agent567: {
			window: {
				minimize: bridge.minimize,
				maximize: bridge.maximize,
				close: bridge.close,
				isMaximized: async () => bridge.maximized,
				onMaximizedChanged: () => () => {},
			},
		},
	});
});
afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

it("has no duplicate account summary and keeps minimize, maximize/restore and close wired", async () => {
	const user = userEvent.setup();
	render(
		<PageHeader
			narrow={false}
			sidebarCollapsed={false}
			onExpandSidebar={() => {}}
			onOverlayOpen={() => {}}
			onOverlayClose={() => {}}
		/>,
	);
	expect(screen.queryByRole("button", { name: /账号菜单/ })).toBeNull();
	expect(screen.queryByText("$21.37")).toBeNull();
	await user.click(screen.getByRole("button", { name: "最小化" }));
	expect(bridge.minimize).toHaveBeenCalledOnce();
	await user.click(screen.getByRole("button", { name: "最大化" }));
	await user.click(await screen.findByRole("button", { name: "还原" }));
	expect(bridge.maximize).toHaveBeenCalledTimes(2);
	await user.click(screen.getByRole("button", { name: "关闭" }));
	expect(bridge.close).toHaveBeenCalledOnce();
});

it("continues using the system traffic lights on macOS", () => {
	render(<DefaultWindowControls model={{ isMac: true, isMaximized: false, controls: [] }} />);
	expect(screen.queryByRole("button")).toBeNull();
});
