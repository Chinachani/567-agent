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
				setUiZoom: vi.fn(),
				resetUiZoom: vi.fn(),
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
				uiZoom: "界面大小",
			},
			title: "外观",
			uiZoomHint: "uiZoomHint",
			uiZoomReset: "恢复默认",
			uiZoomSliderLabel: "界面大小滑块",
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
		uiZoom: { saving: false, default: 1, factor: 1, stepIndex: 2, steps: [0.75, 0.9, 1, 1.1, 1.25, 1.5] },
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
					modeOptions: [{ value: "light", label: "亮色", hint: "浅色模式", icon: "icon-[solar--sun-linear]" }],
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

	it("界面大小显示当前百分比，恢复默认在默认值时不可点", () => {
		const view = render(<AppearanceSettingsView model={model()} />);

		expect(view.getByRole("button", { name: "恢复默认" }).getAttribute("aria-disabled")).toBe("true");
	});

	it("偏离默认值时可恢复默认", async () => {
		const resetUiZoom = vi.fn();
		const view = render(
			<AppearanceSettingsView
				model={model({
					uiZoom: { saving: false, default: 1, factor: 1.25, stepIndex: 4, steps: [0.75, 0.9, 1, 1.1, 1.25, 1.5] },
					actions: { resetUiZoom },
				})}
			/>,
		);

		await userEvent.click(view.getByRole("button", { name: "恢复默认" }));

		expect(resetUiZoom).toHaveBeenCalledTimes(1);
	});

	it("点某一档的文字，按该档的比例设置界面大小，当前档带选中态", async () => {
		const setUiZoom = vi.fn();
		const view = render(<AppearanceSettingsView model={model({ actions: { setUiZoom } })} />);

		expect(view.getByRole("button", { name: "100%" }).getAttribute("aria-pressed")).toBe("true");
		await userEvent.click(view.getByRole("button", { name: "125%" }));

		expect(setUiZoom).toHaveBeenCalledWith(1.25);
	});
});
