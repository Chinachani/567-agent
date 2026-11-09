// @vitest-environment jsdom
import { initI18n } from "@shared/i18n";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ModelsConfigData } from "@preload/api.js";
import { PresetProvidersSection } from "./PresetProvidersSection";
let disk: ModelsConfigData;
let rejectSave = false;
const fetchModels = vi.fn();
const probe = vi.fn();
beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	rejectSave = false;
	disk = { providers: { custom: { models: [{ id: "keep" }] } } };
	fetchModels.mockReset().mockResolvedValue({ models: [{ id: "local", name: "Local model" }] });
	probe.mockReset().mockResolvedValue({ ok: true, message: "reachable" });
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			models: {
				get: async () => structuredClone(disk),
				listPresets: async () => ({
					providers: [
						{
							id: "magpie",
							displayName: "Magpie",
							api: "openai-completions",
							baseUrl: "http://127.0.0.1:3425/v1",
							defaultApiKey: "magpie",
							catalogModels: [],
						},
						{
							id: "openai",
							displayName: "OpenAI",
							api: "openai-responses",
							baseUrl: "https://api.openai.com/v1",
							catalogModels: [],
						},
					],
				}),
				onPresetsUpdated: () => () => {},
				refreshPresetModels: fetchModels,
				probe,
			},
			appMonitor: { recordEvent: () => {} },
		},
	});
});
afterEach(cleanup);
function Page() {
	const [config, setConfig] = useState(disk);
	return (
		<PresetProvidersSection
			config={config}
			saveConfig={async (next) => {
				if (rejectSave) return false;
				disk = structuredClone(next);
				setConfig(next);
				return true;
			}}
		/>
	);
}
it("enables Magpie, pauses without deleting settings, resumes and tests a model without inference", async () => {
	const user = userEvent.setup();
	render(<Page />);
	const toggle = await screen.findByRole("switch", { name: /Magpie/ });
	await user.click(toggle);
	await waitFor(() => expect(disk.providers.magpie?.apiKey).toBe("magpie"));
	expect(disk.providers.custom.models).toEqual([{ id: "keep" }]);
	await user.click(toggle);
	await waitFor(() => expect(disk.providers.magpie.disabled).toBe(true));
	expect(disk.providers.magpie.models?.[0].id).toBe("local");
	await user.click(toggle);
	await waitFor(() => expect(disk.providers.magpie.disabled).toBe(false));
	await user.click(screen.getByRole("button", { name: /Magpie.*1/ }));
	const test = await screen.findByRole("button", { name: /测试连通/ });
	await user.click(test);
	await waitFor(() => expect(probe).toHaveBeenCalledWith({ provider: "magpie", model: "local" }));
	expect(await screen.findByRole("button", { name: /reachable/ })).toBeTruthy();
});
it("keeps failed port edits open, reports errors inside the dialog, preserves unrelated config and restores focus", async () => {
	const user = userEvent.setup();
	render(<Page />);
	const edit = await screen.findByRole("button", { name: /修改端口/ });
	await user.click(edit);
	const dialog = screen.getByRole("dialog");
	const input = within(dialog).getByRole("textbox");
	await waitFor(() => expect(document.activeElement).toBe(input));
	await user.clear(input);
	await user.type(input, "99999");
	expect((within(dialog).getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
	await user.clear(input);
	await user.type(input, "4321");
	fetchModels.mockResolvedValueOnce({ models: [], error: { code: "network" } });
	await user.click(within(dialog).getByRole("button", { name: "保存" }));
	await waitFor(() => expect(within(dialog).getByRole("alert")).toBeTruthy());
	expect(disk.providers.magpie).toBeUndefined();
	expect((input as HTMLInputElement).value).toBe("4321");
	disk.providers.concurrent = { models: [{ id: "retained" }] };
	await user.click(within(dialog).getByRole("button", { name: "保存" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(disk.providers.magpie.baseUrl).toBe("http://127.0.0.1:4321/v1");
	expect(disk.providers.concurrent.models?.[0].id).toBe("retained");
	await waitFor(() => expect(document.activeElement).toBe(edit));
});
it("does not close a key editor or clear its draft when saving is rejected", async () => {
	const user = userEvent.setup();
	render(<Page />);
	await user.click(await screen.findByRole("switch", { name: /OpenAI/ }));
	const dialog = screen.getByRole("dialog");
	const input = within(dialog).getByLabelText(/OpenAI/);
	await user.type(input, "test-key");
	rejectSave = true;
	await user.click(within(dialog).getByRole("button", { name: "启用" }));
	await waitFor(() => expect(fetchModels).toHaveBeenCalled());
	await act(async () => {});
	expect(screen.getByRole("dialog")).toBe(dialog);
	expect((input as HTMLInputElement).value).toBe("test-key");
	expect(disk.providers.openai).toBeUndefined();
	rejectSave = false;
	await user.click(within(dialog).getByRole("button", { name: "启用" }));
	await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	expect(disk.providers.openai.apiKey).toBe("test-key");
});
