// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { ModelContextSettings } from "./ModelContextSettings";
import type { ModelsConfigData } from "@preload/api-types/models";
const config: ModelsConfigData = {
	defaultModel: "custom/gemini",
	providers: {
		custom: {
			baseUrl: "https://example.test/v1",
			apiKey: "",
			models: [
				{ id: "gemini", contextWindow: 1048576 },
				{ id: "gpt-test", contextWindow: 128000 },
			],
		},
	},
};
afterEach(cleanup);
beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});
it("waits for explicit lookup, preserves selection on no matches and lets the user inspect a result", async () => {
	const user = userEvent.setup();
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: { models: { onChanged: () => () => {}, get: async () => config, setContextWindow: vi.fn() } },
	});
	render(<ModelContextSettings config={config} />);
	await user.type(screen.getByRole("textbox", { name: "查找模型" }), "gpt");
	expect(screen.queryByRole("status")).toBeNull();
	await user.click(screen.getByRole("button", { name: "查找" }));
	expect(screen.getByRole("status").textContent).toContain("1 个模型");
	expect(screen.getByText("1,048,576")).toBeDefined();
	await user.click(screen.getByRole("button", { name: "gpt-test · custom" }));
	await waitFor(() => expect(screen.getByText("128,000")).toBeDefined());
	await user.clear(screen.getByRole("textbox", { name: "查找模型" }));
	await user.type(screen.getByRole("textbox", { name: "查找模型" }), "missing");
	await user.click(screen.getByRole("button", { name: "查找" }));
	expect(screen.getByRole("status").textContent).toContain(i18n.t("settings:modelContext.noMatches"));
	expect(screen.getByText("128,000")).toBeDefined();
});
