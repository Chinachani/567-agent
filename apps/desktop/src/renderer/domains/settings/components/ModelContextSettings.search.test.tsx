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

it("saves the selected model's protocol, survives reopening and preserves it on a failed save", async () => {
	const user = userEvent.setup();
	let saved: ModelsConfigData = {
		defaultModel: "custom/codex",
		providers: {
			custom: {
				api: "openai-completions",
				models: [{ id: "codex", api: "openai-responses" }, { id: "gemini" }],
				modelOverrides: { codex: { contextWindow: 64000 } },
			},
		},
	};
	let fail = false;
	const setInferenceApi = vi.fn(async (provider: string, model: string, api: string | null) => {
		if (fail) throw new Error("fixture save failed");
		const next = structuredClone(saved);
		const overrides = (next.providers[provider].modelOverrides ??= {});
		const value = (overrides[model] ??= {});
		if (api === null) delete value.api;
		else value.api = api;
		saved = next;
	});
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			models: {
				onChanged: () => () => {},
				get: async () => saved,
				setInferenceApi,
				setContextWindow: vi.fn(),
			},
		},
	});
	let view = render(<ModelContextSettings config={saved} />);
	expect(screen.getByRole("button", { name: "调用协议" }).textContent).toContain("Responses");
	await user.click(screen.getByRole("button", { name: "调用协议" }));
	await user.click(screen.getByRole("button", { name: "Chat Completions" }));
	await waitFor(() => expect(screen.getByRole("status").textContent).toContain("调用协议已保存"));
	expect(saved.providers.custom.modelOverrides?.codex).toEqual({ contextWindow: 64000, api: "openai-completions" });
	view.unmount();
	view = render(<ModelContextSettings config={saved} />);
	expect(screen.getByRole("button", { name: "调用协议" }).textContent).toBe("Chat Completions");
	fail = true;
	await user.click(screen.getByRole("button", { name: "调用协议" }));
	await user.click(screen.getByRole("button", { name: "Responses" }));
	await waitFor(() => expect(screen.getByRole("status").textContent).toContain("保存失败"));
	expect(screen.getByRole("button", { name: "调用协议" }).textContent).toBe("Chat Completions");
	fail = false;
	await user.click(screen.getByRole("button", { name: "调用协议" }));
	await user.click(screen.getByRole("button", { name: /自动.*Responses/ }));
	await waitFor(() => expect(saved.providers.custom.modelOverrides?.codex).toEqual({ contextWindow: 64000 }));
	expect(screen.getByRole("button", { name: "调用协议" }).textContent).toContain("自动");
	view.unmount();
});
