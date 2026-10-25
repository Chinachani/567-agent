// @vitest-environment jsdom
import i18n from "i18next";
import { initI18n } from "@shared/i18n";
import { act, renderHook, waitFor } from "@testing-library/react";
import { confirmDialogAtom } from "@shared/store/atoms";
import { toastsAtom } from "@shared/store/toast-atoms";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useModelsSettingsModel } from "./useModelsSettingsModel";
import { localModelsConfigAtom, modelCatalog } from "../../../shared/store/model-catalog";
import type { ModelsConfigData } from "../../../../preload/api";
let disk: ModelsConfigData;
beforeEach(async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	disk = { providers: {} };
	getDefaultStore().set(localModelsConfigAtom, null);
	modelCatalog.reset();
	// Only fake preload's external main/storage boundary. Hook, catalog sync, Jotai are real.
	Object.defineProperty(window, "agent567", {
		configurable: true,
		value: {
			models: {
				get: async () => structuredClone(disk),
				set: async (value: ModelsConfigData) => {
					disk = structuredClone(value);
				},
				fetchRemote: async () => ({ providers: {} }),
			},
			appMonitor: { recordEvent: () => undefined },
		},
	});
});
async function addProvider(baseUrl: string) {
	const hook = renderHook(() => useModelsSettingsModel());
	await waitFor(() => expect(hook.result.current.config).not.toBeNull());
	act(() => hook.result.current.onStartAddProvider());
	act(() => hook.result.current.setProviderForm((previous) => ({ ...previous, name: "my-proxy", baseUrl })));
	await act(async () => {
		await hook.result.current.onAddProvider();
	});
	expect(disk.providers["my-proxy"].baseUrl).toBe(baseUrl);
	expect(hook.result.current.config?.providers["my-proxy"].baseUrl).toBe(baseUrl);
	expect(hook.result.current.addingProvider).toBe(false);
	return hook;
}
it("pulls models, selects new entries, saves their parameters and preserves manually configured models", async () => {
	const hook = await addProvider("https://proxy.example.test/v1");
	const existing = { id: "manual", contextWindow: 99999, contextWindowSource: "manual" as const };
	await act(async () =>
		hook.result.current.saveConfig({
			providers: { "my-proxy": { ...disk.providers["my-proxy"], models: [existing] } },
		}),
	);
	window.agent567.models.fetchProviderModels = vi.fn(async () => ({
		models: ["manual", "new"],
		modelDefinitions: [
			{ id: "manual", contextWindow: 1 },
			{
				id: "new",
				contextWindow: 131072,
				contextWindowSource: "api" as const,
				maxTokens: 8192,
				input: ["text", "image"],
				reasoningLevels: ["high", "low"],
				reasoning: true,
			},
		],
	}));
	await act(async () => hook.result.current.onFetchProviderModels("my-proxy"));
	expect(hook.result.current.fetchedModels?.selected).toEqual(["new"]);
	await act(async () => hook.result.current.onApplyFetchedModels("my-proxy"));
	expect(disk.providers["my-proxy"].models).toEqual([
		existing,
		expect.objectContaining({
			id: "new",
			contextWindow: 131072,
			input: ["text", "image"],
			reasoningLevels: ["high", "low"],
		}),
	]);
	hook.unmount();
	const reopened = renderHook(() => useModelsSettingsModel());
	await waitFor(() =>
		expect(reopened.result.current.config?.providers["my-proxy"].models).toEqual(disk.providers["my-proxy"].models),
	);
});

describe("用户新增自定义供应商 → 保存 → 设置页可继续编辑", () => {
	it("普通自建 URL 保存后出现在 providerNames（正常对照）", async () => {
		const hook = await addProvider("https://proxy.example.test/openai/v1");
		expect(hook.result.current.providerNames).toEqual(["my-proxy"]);
	});
	it("路径含官方域名文字的自建 URL 保存后仍可编辑", async () => {
		const hook = await addProvider("https://proxy.example.test/openai/api.567.wiki/v1");
		expect(new URL(disk.providers["my-proxy"].baseUrl!).hostname).toBe("proxy.example.test");
		expect(hook.result.current.providerNames).toEqual(["my-proxy"]);
	});
	it.each(["https://a.567.wiki/v1", "https://api.567.wiki/v1"])(
		"内置服务商在 %s 仍归在线路与分组设置内",
		async (baseUrl) => {
			disk = { providers: { "567api": { baseUrl, displayName: "567 API" } } };
			const hook = renderHook(() => useModelsSettingsModel());
			await waitFor(() => expect(hook.result.current.config).not.toBeNull());
			expect(hook.result.current.providerNames).toEqual([]);
		},
	);
});

it("keeps an unsaved provider form after storage failure, reports it, then allows retry", async () => {
	const hook = renderHook(() => useModelsSettingsModel());
	await waitFor(() => expect(hook.result.current.config).not.toBeNull());
	act(() => {
		hook.result.current.onStartAddProvider();
		hook.result.current.setProviderForm((form) => ({
			...form,
			name: "retry-me",
			baseUrl: "https://example.test/v1",
		}));
	});
	const set = vi.spyOn(window.agent567.models, "set").mockRejectedValueOnce(new Error("read-only"));
	await act(async () => {
		await hook.result.current.onAddProvider();
	});
	expect(hook.result.current.addingProvider).toBe(true);
	expect(hook.result.current.providerForm.name).toBe("retry-me");
	expect(hook.result.current.saving).toBe(false);
	expect(getDefaultStore().get(toastsAtom).at(-1)?.message).toContain("未能保存");
	expect(disk.providers["retry-me"]).toBeUndefined();
	await act(async () => {
		await hook.result.current.onAddProvider();
	});
	expect(set).toHaveBeenCalledTimes(2);
	expect(disk.providers["retry-me"]).toBeDefined();
	expect(hook.result.current.addingProvider).toBe(false);
});

it("rejects duplicate provider names and invalid model limits without overwriting configuration", async () => {
	const hook = await addProvider("https://original.test/v1");
	act(() => {
		hook.result.current.onStartAddProvider();
		hook.result.current.setProviderForm((form) => ({
			...form,
			name: "my-proxy",
			baseUrl: "https://overwrite.test/v1",
		}));
	});
	await act(async () => {
		await hook.result.current.onAddProvider();
	});
	expect(disk.providers["my-proxy"].baseUrl).toBe("https://original.test/v1");
	act(() => {
		hook.result.current.onStartAddModel("my-proxy");
		hook.result.current.setModelForm((form) => ({
			...form,
			id: "invalid",
			contextWindow: "-1",
			maxTokens: "Infinity",
		}));
	});
	await act(async () => {
		await hook.result.current.onAddModel("my-proxy");
	});
	expect(disk.providers["my-proxy"].models).toEqual([]);
	expect(hook.result.current.addingModelFor).toBe("my-proxy");
});

it("confirms removal, keeps data on cancel, and leaves failed deletes available for retry", async () => {
	const hook = await addProvider("https://example.test/v1");
	await act(async () => hook.result.current.onDeleteProvider("my-proxy"));
	expect(disk.providers["my-proxy"]).toBeDefined();
	act(() => getDefaultStore().set(confirmDialogAtom, null));
	expect(disk.providers["my-proxy"]).toBeDefined();
	await act(async () => hook.result.current.onDeleteProvider("my-proxy"));
	vi.spyOn(window.agent567.models, "set").mockRejectedValueOnce(new Error("read-only"));
	act(() => getDefaultStore().get(confirmDialogAtom)?.onConfirm(false));
	await waitFor(() => expect(hook.result.current.saving).toBe(false));
	expect(disk.providers["my-proxy"]).toBeDefined();
	await act(async () => hook.result.current.onDeleteProvider("my-proxy"));
	act(() => getDefaultStore().get(confirmDialogAtom)?.onConfirm(false));
	await waitFor(() => expect(disk.providers["my-proxy"]).toBeUndefined());
});

it("confirms deleting a model and clears its default only after confirmation", async () => {
	const hook = await addProvider("https://example.test/v1");
	await act(async () =>
		hook.result.current.saveConfig({
			providers: { "my-proxy": { models: [{ id: "m" }] } },
			defaultModel: "my-proxy/m",
		}),
	);
	await act(async () => hook.result.current.onDeleteModel("my-proxy", "m"));
	expect(disk.defaultModel).toBe("my-proxy/m");
	expect(disk.providers["my-proxy"].models).toHaveLength(1);
	act(() => getDefaultStore().get(confirmDialogAtom)?.onConfirm(false));
	await waitFor(() => expect(disk.providers["my-proxy"].models).toHaveLength(0));
	expect(disk.defaultModel).toBeUndefined();
});
