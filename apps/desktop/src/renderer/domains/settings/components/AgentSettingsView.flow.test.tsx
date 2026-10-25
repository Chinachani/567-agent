// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { beforeEach, expect, it, vi } from "vitest";
import { AgentSettingsView } from "./AgentSettingsView";
import { useAgentSettingsModel } from "./useAgentSettingsModel";
import type { RuntimeConfigurationModel } from "./useRuntimeConfigurationModel";

const search = vi.hoisted(() => ({ section: "" }));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => search }));
vi.mock("../ai-assist", () => ({ SettingsAiAssist: () => null }));
const save = vi.fn(async () => {});
const update = vi.fn();
const runtime: RuntimeConfigurationModel = {
	actions: { update },
	labels: {
		apply: "应用方式",
		pleaseSelect: "请选择",
		localProvider: "本机",
		remoteProvider: "远程",
		unavailableProvider: "不可用",
	},
	sections: [
		{
			configurationId: "test-runtime",
			apply: "立即生效",
			title: "运行参数",
			fields: [{ border: false, path: ["ocr"], title: "OCR", schema: { type: "boolean" }, value: false }],
		},
	],
};
function Settings() {
	return <AgentSettingsView model={useAgentSettingsModel()} runtimeConfiguration={runtime} />;
}
beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	search.section = "";
	vi.clearAllMocks();
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			session: {
				getPersonas: async () => [],
				getPersonalization: async () => ({ personaId: "default", customPrompt: "old instructions" }),
				setPersonalization: save,
			},
			config: { get: async () => ({ experimental: {} }), set: async () => {} },
			appMonitor: { recordEvent: () => {} },
		},
	});
});
it("retains personalization saving and expands advanced runtime controls on demand", async () => {
	const user = userEvent.setup();
	render(<Settings />);
	const input = await screen.findByDisplayValue("old instructions");
	await user.clear(input);
	await user.type(input, "new instructions");
	await user.click(screen.getByRole("button", { name: i18n.t("settings:agentSettings.apply") }));
	await waitFor(() => expect(save).toHaveBeenCalledWith({ personaId: "default", customPrompt: "new instructions" }));
	const summary = screen.getByText("高级运行设置").closest("summary")!;
	expect(summary.closest("details")?.open).toBe(false);
	expect(screen.queryByText(i18n.t("settings:section_agent-images"))).toBeNull();
	await user.click(summary);
	await waitFor(() => expect(summary.closest("details")?.open).toBe(true));
	await user.click(screen.getByRole("switch", { name: "OCR" }));
	expect(update).toHaveBeenCalledWith("test-runtime", ["ocr"], true);
});
it("expands runtime settings when opened through an existing section link", async () => {
	search.section = "agent-runtime";
	render(<Settings />);
	expect(screen.getByText("高级运行设置").closest("details")?.open).toBe(true);
	expect(screen.getByRole("switch", { name: "OCR" })).toBeTruthy();
	await screen.findByDisplayValue("old instructions");
});
