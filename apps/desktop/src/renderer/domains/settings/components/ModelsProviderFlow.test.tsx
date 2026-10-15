// @vitest-environment jsdom
import { initI18n } from "@shared/i18n";
import { act, renderHook, waitFor } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { beforeEach, describe, expect, it } from "vitest";
import { useModelsSettingsModel } from "./useModelsSettingsModel";
import { localModelsConfigAtom, modelCatalog } from "../../../shared/store/model-catalog";
import type { ModelsConfigData } from "../../../../preload/api";
let disk: ModelsConfigData;
beforeEach(() => {
  initI18n();
  disk = { providers: {} };
  getDefaultStore().set(localModelsConfigAtom, null);
  modelCatalog.reset();
  // Only fake preload's external main/storage boundary. Hook, catalog sync, Jotai are real.
  Object.defineProperty(window, "agent567", { configurable: true, value: {
    models: { get: async () => structuredClone(disk), set: async (value: ModelsConfigData) => { disk = structuredClone(value); }, fetchRemote: async () => ({ providers: {} }) },
    appMonitor: { recordEvent: () => undefined },
  } });
});
async function addProvider(baseUrl: string) {
  const hook = renderHook(() => useModelsSettingsModel());
  await waitFor(() => expect(hook.result.current.config).not.toBeNull());
  act(() => hook.result.current.onStartAddProvider());
  act(() => hook.result.current.setProviderForm(previous => ({ ...previous, name: "my-proxy", baseUrl })));
  await act(async () => { await hook.result.current.onAddProvider(); });
  expect(disk.providers["my-proxy"].baseUrl).toBe(baseUrl);
  expect(hook.result.current.config?.providers["my-proxy"].baseUrl).toBe(baseUrl);
  expect(hook.result.current.addingProvider).toBe(false);
  return hook;
}
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
});
