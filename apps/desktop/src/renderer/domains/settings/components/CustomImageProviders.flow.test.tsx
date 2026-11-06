/** @vitest-environment jsdom */
import type {
	CustomImageProviderInput,
	CustomImageProviderResult,
	CustomImageProviderSummary,
} from "../../../../shared/custom-image-providers";
import { initI18n } from "@shared/i18n";
import { confirmDialogAtom } from "@shared/store/atoms";
import { ConfirmDialog } from "@shared/components/ui/confirm-dialog";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { getDefaultStore } from "jotai";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageGenerationSettingsSection } from "./ImageGenerationSettingsSection";
import { useImageGenerationSettingsModel } from "./useImageGenerationSettingsModel";

vi.mock("@shared/lib/committed-paint", () => ({ waitForCommittedPaint: async () => "painted" }));
vi.mock("./recordSettingsUsage", () => ({ recordSettingsUsage: vi.fn() }));
let entries: CustomImageProviderSummary[];
const list = vi.fn();
const save =
	vi.fn<(input: CustomImageProviderInput) => Promise<CustomImageProviderResult<CustomImageProviderSummary>>>();
const remove = vi.fn();
const setConfig = vi.fn();
function Page() {
	return (
		<>
			<ImageGenerationSettingsSection model={useImageGenerationSettingsModel()} />
			<ConfirmDialog />
		</>
	);
}

beforeAll(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
});
beforeEach(() => {
	entries = [];
	list.mockReset().mockImplementation(async () => ({ ok: true, value: [...entries] }));
	save.mockReset().mockImplementation(async (input) => {
		const { apiKey: _key, ...fields } = input;
		const value = { ...fields, id: input.id ?? "service-1", hasApiKey: true };
		entries = [...entries.filter((entry) => entry.id !== value.id), value];
		return { ok: true, value };
	});
	remove.mockReset().mockImplementation(async (id: string) => {
		entries = entries.filter((entry) => entry.id !== id);
		return { ok: true, value: null };
	});
	setConfig.mockReset().mockResolvedValue(undefined);
	Object.assign(window, {
		agent567: {
			config: { get: async () => ({}), set: setConfig },
			plugins: { onMediaProvidersChanged: () => () => {} },
			media: {
				customImageProviders: { list, save, remove },
				listProviders: async () =>
					entries.map((entry) => ({
						id: `custom-openai:${entry.id}`,
						displayName: entry.name,
						ownerId: "desktop-app",
						protocolVersion: 5,
						capabilities: [
							{
								operation: "generate",
								kind: "image",
								modes: ["text-to-image", "image-to-image"],
								defaultModelId: entry.model,
								models: [
									{
										id: entry.model,
										displayName: entry.model,
										sourceDisplayName: entry.name,
										modes: ["text-to-image", "image-to-image"],
									},
								],
							},
						],
					})),
			},
		},
	});
});
afterEach(() => {
	cleanup();
	act(() => getDefaultStore().set(confirmDialogAtom, null));
});

async function openEditor() {
	const user = userEvent.setup();
	render(<Page />);
	await waitFor(() => expect(screen.getByRole("button", { name: "添加服务" }).hasAttribute("disabled")).toBe(false));
	const add = screen.getByRole("button", { name: "添加服务" });
	await user.click(add);
	return { user, add };
}
async function fill(user: ReturnType<typeof userEvent.setup>) {
	await user.type(screen.getByLabelText("服务名称"), "My Images");
	await user.type(screen.getByLabelText("服务地址（Base URL）"), "https://images.example/v1");
	await user.type(screen.getByLabelText("模型名称"), "image-model");
	await user.type(screen.getByLabelText("API Key"), "sk-private");
}

describe("custom image service settings", () => {
	it("adds a service, selects its route, edits without exposing the key and deletes after confirmation", async () => {
		const { user, add } = await openEditor();
		expect(document.activeElement).toBe(screen.getByLabelText("服务名称"));
		await fill(user);
		await user.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加图片服务" })).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(add));
		await user.click(screen.getByRole("button", { name: "文生图模型" }));
		await user.click(await screen.findByRole("button", { name: "My Images · image-model" }));
		expect(setConfig).toHaveBeenLastCalledWith({
			imageGeneration: { textToImageProviderId: "custom-openai:service-1", textToImageModelId: "image-model" },
		});
		await user.click(screen.getByRole("button", { name: "编辑 My Images" }));
		expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("");
		expect(screen.getByPlaceholderText("已加密保存，留空保持不变")).toBeTruthy();
		await user.clear(screen.getByLabelText("服务名称"));
		await user.type(screen.getByLabelText("服务名称"), "Renamed");
		await user.click(screen.getByRole("button", { name: "保存" }));
		await screen.findByRole("button", { name: "编辑 Renamed" });
		expect(save.mock.calls[1][0]).toMatchObject({ id: "service-1", apiKey: "", name: "Renamed" });
		await user.click(screen.getByRole("button", { name: "删除 Renamed" }));
		expect(remove).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "删除" }));
		await waitFor(() => expect(screen.queryByRole("button", { name: "编辑 Renamed" })).toBeNull());
		expect(remove).toHaveBeenCalledWith("service-1");
	});

	it("keeps the draft when discard is cancelled and restores focus after confirmed discard", async () => {
		const { user, add } = await openEditor();
		await fill(user);
		await user.click(screen.getByRole("button", { name: "取消" }));
		expect(screen.getByText("放弃未保存的修改？")).toBeTruthy();
		const buttons = screen.getAllByRole("button", { name: "取消" });
		await user.click(buttons.at(-1)!);
		expect((screen.getByLabelText("服务名称") as HTMLInputElement).value).toBe("My Images");
		expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("sk-private");
		await user.click(
			within(screen.getByRole("dialog", { name: "添加图片服务" })).getByRole("button", {
				name: "取消",
			}),
		);
		await user.click(screen.getByRole("button", { name: "放弃修改" }));
		await waitFor(() => expect(screen.queryByRole("dialog", { name: "添加图片服务" })).toBeNull());
		await waitFor(() => expect(document.activeElement).toBe(add));
		expect(save).not.toHaveBeenCalled();
	});

	it("retains failed input, blocks duplicate saves, and requires a key after origin changes", async () => {
		const { user } = await openEditor();
		await fill(user);
		save.mockResolvedValueOnce({ ok: false, error: "secret-storage-unavailable" });
		await user.click(screen.getByRole("button", { name: "保存" }));
		expect((await screen.findByRole("alert")).textContent).toContain("配置未保存");
		expect((screen.getByLabelText("API Key") as HTMLInputElement).value).toBe("sk-private");
		let finish!: (value: CustomImageProviderResult<CustomImageProviderSummary>) => void;
		save.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		await user.dblClick(screen.getByRole("button", { name: "保存" }));
		expect(save).toHaveBeenCalledTimes(2);
		const value = {
			id: "service-1",
			name: "My Images",
			model: "image-model",
			baseUrl: "https://images.example/v1",
			supportsTextToImage: true,
			supportsImageToImage: true,
			hasApiKey: true,
		};
		entries = [value];
		await act(async () => finish({ ok: true, value }));
		await user.click(await screen.findByRole("button", { name: "编辑 My Images" }));
		await user.clear(screen.getByLabelText("服务地址（Base URL）"));
		await user.type(screen.getByLabelText("服务地址（Base URL）"), "https://other.example/v1");
		expect(screen.getByText(/服务地址的主机已更改/)).toBeTruthy();
		expect((screen.getByLabelText("API Key") as HTMLInputElement).required).toBe(true);
	});
});
