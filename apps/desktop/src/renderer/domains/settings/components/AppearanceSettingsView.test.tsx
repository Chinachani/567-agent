// @vitest-environment jsdom
/**
 * 外观设置页的「新会话页装饰」这块区域：装饰件与纹理收在同一块里，
 * 用户点纹理卡片能把选择交回模型，选中态跟着走。
 */
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AppearanceSettingsModel } from "./useAppearanceSettingsModel";

const { renderOrbitPreview } = vi.hoisted(() => ({ renderOrbitPreview: vi.fn() }));

vi.mock("@shared/components/orb/OrbitOrb", () => ({
	OrbitOrb: () => {
		renderOrbitPreview();
		return <div data-testid="orbit-preview" />;
	},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));

const { AppearanceSettingsView } = await import("./AppearanceSettingsView.js");

function model(
	overrides: Partial<Omit<AppearanceSettingsModel, "actions">> & {
		actions?: Partial<AppearanceSettingsModel["actions"]>;
	} = {},
): AppearanceSettingsModel {
	return {
		actions: Object.assign(
			{
				changeLanguage: vi.fn(),
				changeMode: vi.fn(),
				changeThemeName: vi.fn(),
				selectUiTheme: vi.fn(),
				setCursorStyle: vi.fn(),
				setSidebarStyle: vi.fn(),
			},
			overrides.actions,
		),
		activeUiThemeId: "default",
		cursorOptions: [],
		cursorStyle: "default",
		labels: {
			languageHint: "languageHint",
			sections: {
				cursor: "鼠标指针",
				language: "语言",
				mode: "外观模式",
				sidebar: "侧边栏样式",
				theme: "主题颜色",
				uiTheme: "界面主题",
			},
			title: "外观",
		},
		language: "system",
		languages: [],
		mode: "dark",
		modeOptions: [],
		narrow: true,
		showUiTheme: false,
		sidebarStyle: "classic",
		sidebarStyleOptions: [],
		themeName: "default",
		themes: [],
		uiThemes: [],
		...overrides,
	};
}

describe("AppearanceSettingsView", () => {
	it("omits retired decoration and texture controls while retaining appearance choices", async () => {
		const changeMode = vi.fn();
		const view = render(
			<AppearanceSettingsView
				model={model({
					actions: { changeMode },
					modeOptions: [{ value: "light", label: "亮色", hint: "浅色模式", icon: "icon-[mdi--sun]" }],
				})}
			/>,
		);
		expect(view.queryByText("新会话页装饰")).toBeNull();
		expect(view.queryByText("装饰件")).toBeNull();
		expect(view.queryByText("纹理")).toBeNull();
		expect(view.getByText("鼠标指针")).toBeTruthy();
		expect(view.getByText("侧边栏样式")).toBeTruthy();
		await userEvent.click(view.getByRole("button", { name: /亮色/ }));
		expect(changeMode).toHaveBeenCalledWith("light", expect.any(Object));
		expect(renderOrbitPreview).not.toHaveBeenCalled();
	});
});
