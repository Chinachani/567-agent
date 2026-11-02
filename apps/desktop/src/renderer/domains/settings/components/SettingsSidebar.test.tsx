// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsSidebarView } from "@vetta-org/theme-ui/settings";

const TABS = [
	{ key: "general", icon: "icon-[solar--settings-linear]", label: "通用设置" },
	{
		key: "workspace:browser/console",
		icon: "icon-[solar--window-frame-linear]",
		label: "浏览器操作",
		separatorBefore: true,
	},
	{
		key: "workspace:design/gallery",
		icon: "icon-[solar--palette-linear]",
		iconUrl: "vetta-plugin://design/icon.png",
		label: "设计",
	},
];
type SidebarOverrides = Partial<Parameters<typeof SettingsSidebarView>[0]>;
function renderSidebar(overrides: SidebarOverrides = {}) {
	const onSelectTab = vi.fn();
	const view = (extra: SidebarOverrides) => (
		<SettingsSidebarView
			activeTab="general"
			betaBadgeLabel="BETA"
			narrow={false}
			onSelectTab={onSelectTab}
			tabs={TABS}
			title="设置"
			{...overrides}
			{...extra}
		/>
	);
	const rendered = render(view({}));
	return { onSelectTab, rerender: (extra: SidebarOverrides) => rendered.rerender(view(extra)) };
}
describe("flat SettingsSidebarView", () => {
	it("prefetches on hover/focus and selects only on activation", () => {
		const onTabIntent = vi.fn();
		const { onSelectTab } = renderSidebar({ onTabIntent });
		const settings = screen.getByRole("button", { name: "通用设置" });
		fireEvent.mouseEnter(settings);
		fireEvent.focus(settings);
		expect(onTabIntent).toHaveBeenCalledWith("general");
		expect(onSelectTab).not.toHaveBeenCalled();
		fireEvent.click(settings);
		expect(onSelectTab).toHaveBeenCalledWith("general");
	});
	it("always exposes plugin entries at the same level with exactly one selected page", async () => {
		const { onSelectTab, rerender } = renderSidebar();
		expect(screen.getAllByRole("button")).toHaveLength(3);
		await userEvent.click(screen.getByRole("button", { name: "浏览器操作" }));
		expect(onSelectTab).toHaveBeenCalledWith("workspace:browser/console");
		rerender({ activeTab: "workspace:browser/console" });
		expect(screen.getAllByRole("button", { current: "page" })).toHaveLength(1);
		expect(screen.getByRole("button", { name: "浏览器操作" }).getAttribute("aria-current")).toBe("page");
		expect(screen.getByRole("button", { name: "通用设置" }).getAttribute("aria-expanded")).toBeNull();
	});
	it("keeps plugin icon navigation accessible by keyboard in a narrow sidebar", async () => {
		const user = userEvent.setup();
		const { onSelectTab } = renderSidebar({ narrow: true, activeTab: "workspace:design/gallery" });
		const design = screen.getByRole("button", { name: "设计" });
		expect(design.getAttribute("aria-current")).toBe("page");
		expect(design.querySelector("img")?.getAttribute("src")).toBe("vetta-plugin://design/icon.png");
		await user.tab();
		await user.tab();
		await user.keyboard("{Enter}");
		expect(onSelectTab).toHaveBeenCalledWith("workspace:browser/console");
	});
});
