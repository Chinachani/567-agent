// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { createStore, Provider } from "jotai";
import i18n from "i18next";
import { afterEach, expect, it, vi } from "vitest";
import { initI18n } from "@shared/i18n";
import { pluginWorkspaceViewsAtom } from "@shared/store/atoms";
import { useSettingsPageModel } from "./useSettingsPageModel";
import { SettingsSidebar } from "./SettingsSidebar";

afterEach(() => vi.restoreAllMocks());
it("opens flat plugin entries, preserves old deep links and removes uninstalled entries without a group", async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	const store = createStore();
	store.set(pluginWorkspaceViewsAtom, [
		{
			pluginId: "browser",
			pluginName: "Browser",
			viewId: "console",
			label: "浏览器操作",
			component: () => null,
			navOrder: 1,
			sidebar: false,
		},
		{
			pluginId: "canvas",
			pluginName: "Canvas",
			viewId: "design",
			label: "画布",
			component: () => null,
			navOrder: 2,
			sidebar: true,
		},
	]);
	function Settings() {
		const model = useSettingsPageModel();
		return (
			<>
				<SettingsSidebar model={model} />
				<output data-testid="page">
					{model.embeddedView ? `${model.embeddedView.pluginId}/${model.embeddedView.viewId}` : model.activeTab}
				</output>
			</>
		);
	}
	const root = createRootRoute();
	const settings = createRoute({
		getParentRoute: () => root,
		path: "/settings/$tab",
		component: Settings,
		validateSearch: (search) => search,
	});
	const router = createRouter({
		routeTree: root.addChildren([settings]),
		history: createMemoryHistory({ initialEntries: ["/settings/general"] }),
	});
	await router.load();
	const user = userEvent.setup();
	render(
		<Provider store={store}>
			<RouterProvider router={router} />
		</Provider>,
	);
	const browser = await screen.findByRole("button", { name: "浏览器操作" });
	expect(screen.queryByRole("button", { name: "更多选项" })).toBeNull();
	expect(screen.queryByRole("button", { name: "画布" })).toBeNull();
	await user.click(browser);
	await waitFor(() => expect(screen.getByTestId("page").textContent).toBe("browser/console"));
	expect(router.state.location.pathname).toBe("/settings/extensions");
	expect(screen.getAllByRole("button", { current: "page" })).toHaveLength(1);
	await user.click(screen.getByRole("button", { name: "通用设置" }));
	await waitFor(() => expect(router.state.location.search).toEqual({}));
	await act(async () => {
		await router.navigate({
			to: "/settings/$tab",
			params: { tab: "extensions" },
			search: { view: "browser/console" },
		});
	});
	await waitFor(() => expect(screen.getByTestId("page").textContent).toBe("browser/console"));
	expect(screen.getByRole("button", { name: "浏览器操作" }).getAttribute("aria-current")).toBe("page");
	await act(async () => {
		store.set(pluginWorkspaceViewsAtom, []);
	});
	expect(screen.queryByRole("button", { name: "浏览器操作" })).toBeNull();
	expect(screen.queryByRole("button", { name: "更多选项" })).toBeNull();
});
