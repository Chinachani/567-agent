/** @vitest-environment jsdom */

import { initI18n } from "@shared/i18n";
import { pluginWorkspaceViewsAtom } from "@shared/store/atoms";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import i18n from "i18next";
import { createStore, Provider } from "jotai";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { markPluginHostReady } from "../../plugins/runtime/plugin-events";
import { SETTINGS_TAB_LOADERS } from "./settings-tab-loaders";
import { SettingsPage } from "./SettingsPage";

vi.mock("@shared/lib/committed-paint", () => ({ waitForCommittedPaint: async () => undefined }));

beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	markPluginHostReady();
});

beforeEach(() => {
	vi.spyOn(window, "scrollTo").mockImplementation(() => {});
	Element.prototype.scrollIntoView = vi.fn();
	Object.assign(window, {
		agent567: {
			mcp: {
				get: vi.fn(async () => ({ mcpServers: {} })),
				set: vi.fn(async () => undefined),
			},
			auth: { openExternal: vi.fn(async () => undefined) },
			settings: {
				getBrowserTargets: vi.fn(async () => ({
					defaultBrowser: "msedge",
					defaultApplication: "Microsoft Edge",
					available: ["msedge", "chrome"],
				})),
				prepareBrowserTarget: vi.fn(async (id: string) => ({ id })),
			},
			updater: {
				getPreferences: vi.fn(async () => ({
					automaticCheck: true,
					checkIntervalMinutes: 120,
					automaticDownload: true,
					showReminder: true,
				})),
				setPreferences: vi.fn(async (value) => value),
				getReleaseHistory: vi.fn(async () => ({ baselineVersion: "1.6.4", releases: [] })),
			},
			config: { get: vi.fn(async () => ({ notificationsEnabled: true })), set: vi.fn(async () => undefined) },
			appMonitor: { recordEvent: vi.fn() },
		},
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function renderSettingsAt(initialUrl: string, store: ReturnType<typeof createStore>) {
	const root = createRootRoute();
	const settings = createRoute({
		getParentRoute: () => root,
		path: "/settings/$tab",
		component: SettingsPage,
		validateSearch: (search) => search,
	});
	const router = createRouter({
		routeTree: root.addChildren([settings]),
		history: createMemoryHistory({ initialEntries: [initialUrl] }),
	});
	return {
		router,
		loaded: router.load().then(() =>
			render(
				<Provider store={store}>
					<RouterProvider router={router} />
				</Provider>,
			),
		),
	};
}

describe("SettingsPage browser integration", () => {
	it("renders cohesive page header, host connection card, and embedded plugin console when browser plugin is present", async () => {
		const store = createStore();
		store.set(pluginWorkspaceViewsAtom, [
			{
				pluginId: "browser",
				pluginName: "浏览器操作",
				viewId: "console",
				label: "浏览器操作",
				navOrder: 1,
				sidebar: false,
				component: () => (
					<div className="browser-page" data-testid="browser-console">
						<div className="browser-page-inner">
							<header data-browser-hero="">Duplicate hero</header>
							<section data-browser-runtime="">Runtime panel</section>
							<details data-browser-extension="">Duplicate extension</details>
							<section data-browser-prompts="">Example prompts</section>
						</div>
					</div>
				),
			},
		]);

		const { loaded } = renderSettingsAt("/settings/extensions?view=browser%2Fconsole", store);
		await loaded;

		expect(await screen.findByRole("heading", { level: 1, name: "浏览器操作" })).toBeTruthy();
		expect(screen.getByRole("heading", { level: 2, name: "连接当前浏览器" })).toBeTruthy();
		expect(screen.getByText("未配置")).toBeTruthy();
		expect(screen.getByTestId("browser-console")).toBeTruthy();
		expect(screen.getByText("Runtime panel")).toBeTruthy();
		expect(screen.getByText("Example prompts")).toBeTruthy();
	});

	it("falls back to general settings browser section when browser plugin is absent", async () => {
		await SETTINGS_TAB_LOADERS.general();
		const store = createStore();
		store.set(pluginWorkspaceViewsAtom, []);

		const { router, loaded } = renderSettingsAt("/settings/extensions?view=browser%2Fconsole", store);
		await loaded;

		await waitFor(() => expect(router.state.location.pathname).toBe("/settings/general"));
		expect(router.state.location.search).toEqual({ section: "general-browser-connection" });
		expect(await screen.findByRole("heading", { level: 2, name: "连接当前浏览器" })).toBeTruthy();
		expect(screen.queryByRole("heading", { level: 1, name: "浏览器操作" })).toBeNull();
	});
});
