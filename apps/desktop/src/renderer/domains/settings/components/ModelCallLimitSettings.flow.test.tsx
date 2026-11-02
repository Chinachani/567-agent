/** @vitest-environment jsdom */
import { CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID } from "@567agent/coding-agent/settings";
import { DesktopRuntimeConfigurationService } from "../../../../main/runtime-configuration/runtime-configuration-service";
import { initI18n } from "@shared/i18n";
import { ModelCallLimitSettingsView } from "@vetta-org/theme-ui/settings";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useModelCallLimitSettingsModel } from "./useModelCallLimitSettingsModel";

const paint = vi.hoisted(() => ({ run: vi.fn<() => Promise<unknown>>() }));
vi.mock("@shared/lib/committed-paint", () => ({ waitForCommittedPaint: paint.run }));
let document: Record<string, unknown>;
let service: DesktopRuntimeConfigurationService;
let list: ReturnType<typeof vi.fn>;
let set: ReturnType<typeof vi.fn>;
function Settings() {
	return <ModelCallLimitSettingsView model={useModelCallLimitSettingsModel()} />;
}
beforeEach(async () => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	initI18n();
	await i18n.changeLanguage("zh");
	paint.run.mockReset().mockResolvedValue("painted");
	document = { custom: { keep: "unchanged" } };
	service = new DesktopRuntimeConfigurationService({
		readAgentSettings: () => structuredClone(document),
		updateAgentSettings: (mutate) => {
			mutate(document);
		},
		logger: { info: vi.fn(), warn: vi.fn() },
	});
	list = vi.fn(() => service.list());
	set = vi.fn((id, patch) => service.set(id, patch));
	Object.assign(window, { agent567: { runtimeConfiguration: { list, set } } });
});
afterEach(async () => {
	cleanup();
	await service.close();
	vi.unstubAllGlobals();
});

it("paints before loading and saves off/on with the previous count across reopening", async () => {
	let release!: () => void;
	paint.run.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	const user = userEvent.setup();
	const page = render(<Settings />);
	expect(screen.getByRole("heading", { name: "任务执行" })).toBeTruthy();
	expect(list).not.toHaveBeenCalled();
	await act(async () => release());
	const input = (await screen.findByRole("textbox", { name: "最大调用次数" })) as HTMLInputElement;
	await waitFor(() => expect(input.disabled).toBe(false));
	expect(input.value).toBe("100");
	await user.click(screen.getByRole("button", { name: "200" }));
	expect(set).not.toHaveBeenCalled();
	await user.click(screen.getByRole("switch", { name: "单轮模型调用上限" }));
	expect(input.disabled).toBe(true);
	expect(input.value).toBe("200");
	await user.click(screen.getByRole("button", { name: "保存" }));
	await screen.findByText("已保存，将从下一轮运行生效。");
	expect(service.readModelCallLimit()).toEqual({ enabled: false, maxCalls: 200 });
	expect(document.custom).toEqual({ keep: "unchanged" });
	page.unmount();
	render(<Settings />);
	await screen.findByDisplayValue("200");
	await waitFor(() => expect(screen.getByRole("switch").hasAttribute("disabled")).toBe(false));
	await user.click(screen.getByRole("switch"));
	expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("200");
	await user.click(screen.getByRole("button", { name: "保存" }));
	await waitFor(() => expect(service.readModelCallLimit()).toEqual({ enabled: true, maxCalls: 200 }));
});

it("validates input, retains a failed-save draft, retries once and can reset to the default", async () => {
	const user = userEvent.setup();
	render(<Settings />);
	const input = screen.getByRole("textbox") as HTMLInputElement;
	await waitFor(() => expect(input.disabled).toBe(false));
	for (const value of ["0", "-1", "1.5", "words", "9007199254740992"]) {
		await user.clear(input);
		await user.type(input, value);
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByRole("button", { name: "保存" }).hasAttribute("disabled")).toBe(true);
	}
	expect(set).not.toHaveBeenCalled();
	await user.clear(input);
	await user.type(input, "300");
	set.mockRejectedValueOnce(new Error("disk write failed"));
	await user.click(screen.getByRole("button", { name: "保存" }));
	expect((await screen.findByRole("alert")).textContent).toContain("你填写的内容已保留");
	expect(input.value).toBe("300");
	await user.dblClick(screen.getByRole("button", { name: "重试" }));
	await screen.findByText("已保存，将从下一轮运行生效。");
	expect(set).toHaveBeenCalledTimes(2);
	expect(service.readModelCallLimit()).toEqual({ enabled: true, maxCalls: 300 });
	await user.click(screen.getByRole("button", { name: "恢复默认（100 次）" }));
	expect(input.value).toBe("100");
	expect(service.readModelCallLimit().maxCalls).toBe(300);
	await user.click(screen.getByRole("button", { name: "保存" }));
	await waitFor(() => expect(service.readModelCallLimit().maxCalls).toBe(100));
});

it("recovers a read failure without writing and keeps an edited draft when language changes", async () => {
	const user = userEvent.setup();
	list.mockRejectedValueOnce(new Error("read failure"));
	render(<Settings />);
	expect((await screen.findByRole("alert")).textContent).toContain("未能读取");
	await user.click(screen.getByRole("button", { name: "重试" }));
	const input = screen.getByRole("textbox") as HTMLInputElement;
	await waitFor(() => expect(input.disabled).toBe(false));
	await user.clear(input);
	await user.type(input, "450");
	await act(async () => {
		await i18n.changeLanguage("en");
	});
	expect((screen.getByRole("textbox", { name: "Maximum model calls" }) as HTMLInputElement).value).toBe("450");
	expect(list).toHaveBeenCalledTimes(2);
	expect(set).not.toHaveBeenCalled();
	await user.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(set).toHaveBeenCalledWith(CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID, {
			enabled: true,
			maxCalls: 450,
		}),
	);
});
