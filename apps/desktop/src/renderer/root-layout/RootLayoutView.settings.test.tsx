// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RootLayoutModel } from "./types";

vi.mock("@tanstack/react-router", () => ({ Outlet: () => <section>Settings content</section> }));
vi.mock("@vetta-org/theme-sdk", () => ({
	useThemeComponent: (_slot: string, fallback: unknown) => fallback,
	useThemeSurface: () => undefined,
}));
vi.mock("../shared/theme/pages", () => ({ useActiveThemePageRoute: () => undefined }));
vi.mock("../domains/plugins/components/WorkspaceViewHeaderSlot", () => ({
	useActiveWorkspaceViewHeader: () => undefined,
}));
vi.mock("../domains/project/components/sidebar/Sidebar", () => ({
	Sidebar: () => <nav aria-label="Workspace sessions" />,
}));
vi.mock("../shared/app-shell/page-header", () => ({
	PageHeader: ({ narrow, sidebarCollapsed }: { narrow: boolean; sidebarCollapsed: boolean }) => (
		<header>
			<button type="button">Window controls</button>
			{(narrow || sidebarCollapsed) && <button type="button">Open sidebar</button>}
		</header>
	),
}));
vi.mock("../domains/command-menu/components/CommandMenu", () => ({ CommandMenu: () => null }));
vi.mock("../shared/tour", () => ({ SidebarTour: () => null }));
vi.mock("./RootGlobalOverlays", () => ({ RootGlobalOverlays: () => null }));
vi.mock("./app-background/AppBackground", () => ({ AppBackground: () => null }));
import { RootLayoutView } from "./RootLayoutView";

const model: RootLayoutModel = {
	actions: { closeOverlay: vi.fn(), openOverlay: vi.fn(), scheduleOverlayClose: vi.fn(), toggleSidebar: vi.fn() },
	settingsMode: false,
	narrow: false,
	sidebarCollapsed: false,
	sidebarWidth: 240,
	overlayOpen: false,
	routePending: false,
	onOpenSession: vi.fn(),
};
describe("settings workspace layout", () => {
	it("removes the workspace sidebar while retaining page content and window chrome, then restores it", () => {
		const view = render(<RootLayoutView model={model} />);
		expect(screen.getByRole("navigation", { name: "Workspace sessions" })).toBeTruthy();
		view.rerender(<RootLayoutView model={{ ...model, settingsMode: true }} />);
		expect(screen.queryByRole("navigation", { name: "Workspace sessions" })).toBeNull();
		expect(screen.getByRole("main").contains(screen.getByText("Settings content"))).toBe(true);
		expect(screen.getByRole("button", { name: "Window controls" })).toBeTruthy();
		expect(view.container.querySelector('[data-sidebar-visible="false"]')).toBeTruthy();
		view.rerender(<RootLayoutView model={model} />);
		expect(screen.getByRole("navigation", { name: "Workspace sessions" })).toBeTruthy();
	});
	it("does not offer the hidden workspace overlay from narrow or previously collapsed settings", () => {
		render(
			<RootLayoutView
				model={{ ...model, settingsMode: true, narrow: true, sidebarCollapsed: true, overlayOpen: true }}
			/>,
		);
		expect(screen.queryByRole("navigation")).toBeNull();
		expect(screen.queryByRole("button", { name: "Open sidebar" })).toBeNull();
	});
});
