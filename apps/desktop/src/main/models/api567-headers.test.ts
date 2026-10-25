import { expect, it } from "vitest";
import { type ModelsConfig, normalizeModelsConfig } from "./model-settings-service.js";

it("drops persisted security proofs only from managed providers while retaining group, key and custom headers", () => {
	const headers = {
		"X-567-Group": "default",
		"x-567-timestamp": "old",
		"X-567-Nonce": "replayed",
		"X-567-Signature": "old-signature",
		"X-567-Device-ID": "old-device",
		"X-567-Version": "old-version",
		"X-567-Client": "old-client",
		"X-Region": "kept",
	};
	const config: ModelsConfig = {
		providers: {
			"567api": { baseUrl: "https://api.567.wiki/v1", apiKey: "fixture", headers, models: [{ id: "model" }] },
			custom: { headers: { ...headers } },
		},
	};
	const normalized = normalizeModelsConfig(config, "https://api.567.wiki", []);
	expect(normalized.providers["567api"].headers).toEqual({ "X-567-Group": "default", "X-Region": "kept" });
	expect(normalized.providers["567api"].apiKey).toBe("fixture");
	expect(normalized.providers.custom.headers).toEqual(headers);
	expect(config.providers["567api"].headers).toBe(headers);
	expect(headers["X-567-Nonce"]).toBe("replayed");
});
