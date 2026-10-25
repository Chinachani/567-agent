// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { createStore, Provider, useAtomValue } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "i18next";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import { pageHeaderLeftSlotAtom, settingsReturnHrefAtom } from "@shared/store/atoms";
import { useSettingsPageModel } from "../../domains/settings/components/useSettingsPageModel";
import { useSettingsReturnLocation } from "./useSettingsReturnLocation";
afterEach(() => vi.restoreAllMocks());

it("returns to the original workspace after navigating through settings tabs, retaining search", async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	const store = createStore();
	function Shell() {
		useSettingsReturnLocation();
		const href = useAtomValue(settingsReturnHrefAtom);
		const back = useAtomValue(pageHeaderLeftSlotAtom);
		return (
			<>
				<header>{back}</header>
				<output>{href}</output>
				<Outlet />
			</>
		);
	}
	function Settings() {
		const model = useSettingsPageModel();
		return <div data-testid="settings-tab">{model.activeTab}</div>;
	}
	const root = createRootRoute({ component: Shell });
	const workspace = createRoute({ getParentRoute: () => root, path: "/project", component: () => <div>Project</div> });
	const settings = createRoute({
		getParentRoute: () => root,
		path: "/settings/$tab",
		component: Settings,
		validateSearch: (search) => search,
	});
	const router = createRouter({
		routeTree: root.addChildren([workspace, settings]),
		history: createMemoryHistory({ initialEntries: ["/project?cwd=%2Fexample"] }),
	});
	await router.load();
	render(
		<Provider store={store}>
			<RouterProvider router={router} />
		</Provider>,
	);
	await screen.findByText("Project");
	await act(async () => {
		await router.navigate({ to: "/settings/$tab", params: { tab: "general" } });
	});
	expect(screen.getByRole("status").textContent).toBe("/project?cwd=%2Fexample");
	await act(async () => {
		await router.navigate({ to: "/settings/$tab", params: { tab: "models" } });
	});
	expect(store.get(settingsReturnHrefAtom)).toBe("/project?cwd=%2Fexample");
	await act(async () => {
		await router.navigate({ to: "/settings/$tab", params: { tab: "context" }, search: { section: "agent-images" } });
	});
	await screen.findByText("models");
	expect(router.state.location.pathname).toBe("/settings/models");
	await userEvent.click(screen.getByRole("button", { name: "返回工作区" }));
	await screen.findByText("Project");
	expect(router.state.location.href).toBe("/project?cwd=%2Fexample");
});
