import { beforeEach, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ fetch: vi.fn(), key: vi.fn(), config: vi.fn() }));
vi.mock("electron", () => ({ net: { fetch: fakes.fetch } }));
vi.mock("./model-settings-host.js", () => ({ getDesktopModelSettingsService: () => ({ getConfig: fakes.config }) }));
vi.mock("./model-credential-store.js", () => ({ getDesktopModelCredentialStore: () => ({ get: fakes.key }) }));
vi.mock("../i18n/index.js", () => ({ mainT: (key: string) => key }));

import { fetchProviderModels } from "./fetch-models.js";

beforeEach(() => vi.resetAllMocks());
it("fetches with a main-only vault key and returns both legacy IDs and explicit model metadata", async () => {
	fakes.config.mockResolvedValue({
		providers: { local: { baseUrl: "https://proxy.example/v1", apiKey: "***", credentialRef: "ref" } },
	});
	fakes.key.mockReturnValue("test-vault-key");
	fakes.fetch.mockResolvedValue(
		new Response(JSON.stringify({ data: [{ id: "a", context_length: 65536, supports_vision: true }] })),
	);
	const result = await fetchProviderModels("local");
	expect(fakes.fetch).toHaveBeenCalledWith(
		"https://proxy.example/v1/models",
		expect.objectContaining({ headers: { Authorization: "Bearer test-vault-key" } }),
	);
	expect(result).toMatchObject({
		models: ["a"],
		modelDefinitions: [{ id: "a", contextWindow: 65536, input: ["text", "image"] }],
	});
	expect(JSON.stringify(result)).not.toContain("test-vault-key");
});
it("does not send a masked or unavailable credential to the provider", async () => {
	fakes.config.mockResolvedValue({
		providers: { local: { baseUrl: "https://proxy.example/v1", apiKey: "***", credentialRef: "ref" } },
	});
	expect(await fetchProviderModels("local")).toMatchObject({ models: [], error: "providerModels.missingKey" });
	expect(fakes.fetch).not.toHaveBeenCalled();
});
