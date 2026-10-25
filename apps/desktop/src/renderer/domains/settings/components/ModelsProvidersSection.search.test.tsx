/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import { getDefaultStore } from "jotai";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localModelsConfigAtom, modelCatalog } from "../../../shared/store/model-catalog";
import { ModelsProvidersSection } from "./ModelsProvidersSection";
import { useModelsSettingsModel } from "./useModelsSettingsModel";

function Page() {
	const model = useModelsSettingsModel();
	return <ModelsProvidersSection model={model} />;
}
beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	modelCatalog.reset();
	getDefaultStore().set(localModelsConfigAtom, null);
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			models: {
				get: async () => ({
					providers: {
						Alpha: { baseUrl: "https://alpha.test/v1", models: [{ id: "vision-pro" }] },
						Beta: { baseUrl: "https://beta.test/v1", models: [{ id: "text-fast" }] },
					},
				}),
				fetchRemote: async () => ({ providers: {} }),
				set: vi.fn(async () => {}),
			},
			appMonitor: { recordEvent: () => {} },
		},
	});
});
afterEach(cleanup);

it("filters providers by their models, clears no results and retains an in-progress provider edit", async () => {
	const user = userEvent.setup();
	render(<Page />);
	await screen.findByText("Alpha");
	const search = screen.getByRole("searchbox", { name: "搜索服务商或模型" });
	await user.type(search, "VISION");
	expect(screen.queryByText("Beta")).toBeNull();
	await user.click(screen.getByRole("button", { name: /^Alpha/ }));
	expect(screen.getByText("vision-pro")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "编辑 Alpha 的连接配置" }));
	const name = screen.getByDisplayValue("Alpha");
	await user.clear(name);
	await user.type(name, "Unsaved Alpha");
	await user.clear(search);
	await user.type(search, "Beta");
	expect(screen.getByDisplayValue("Unsaved Alpha")).toBeTruthy();
	expect(screen.getByText("Beta")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "取消" }));
	await user.clear(search);
	await user.type(search, "no-such-provider");
	expect(screen.getByRole("status").textContent).toContain("没有匹配");
	await user.click(screen.getByRole("button", { name: "清除搜索" }));
	await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
	expect(screen.getByText("Beta")).toBeTruthy();
	expect(window.agent567.models.set).not.toHaveBeenCalled();
});
