import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ArtifactStore } from "../artifacts/artifact-store.js";
import { JobManager } from "../jobs/job-manager.js";
import { create567ApiImageProvider } from "./567api-image-provider.js";
import { MediaArtifactStore } from "./media-artifact-store.js";
import { MediaProviderRegistry } from "./media-provider-registry.js";

const newApiServiceMocks = vi.hoisted(() => ({
	getAvailableImageModels: vi.fn(),
	getImageModel: vi.fn(),
	getImageGroup: vi.fn(),
	getApiKey: vi.fn(),
	getServiceOrigin: vi.fn(() => "https://api.567.wiki"),
}));

vi.mock("../567api/newapi-service.js", () => ({
	NewApiService: {
		getInstance: () => newApiServiceMocks,
	},
}));

describe("567ApiImageProvider", () => {
	it("keeps a generation on its submission route and does not resubmit it on a switch", async () => {
		const root = mkdtempSync(join(tmpdir(), "567-image-route-"));
		let origin = "https://api.567.wiki";
		newApiServiceMocks.getServiceOrigin.mockImplementation(() => origin);
		newApiServiceMocks.getImageGroup.mockReturnValue("images");
		newApiServiceMocks.getImageModel.mockReturnValue("test-image");
		let release!: (key: string) => void;
		newApiServiceMocks.getApiKey.mockImplementation(
			() =>
				new Promise<string>((resolve) => {
					release = resolve;
				}),
		);
		const fetch = vi.fn(
			async (_url: string, _options?: RequestInit) =>
				new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200 }),
		);
		vi.stubGlobal("fetch", fetch);
		try {
			const provider = create567ApiImageProvider(new MediaArtifactStore(new ArtifactStore({ root })));
			const result = provider.submit(
				{ operation: "generate", kind: "image", mode: "text-to-image", prompt: "draw", inputs: [] },
				{ ownerId: "owner", signal: new AbortController().signal },
			);
			origin = "https://a.567.wiki";
			release("image-key");
			expect((await result).status).toBe("succeeded");
			expect(fetch).toHaveBeenCalledTimes(1);
			expect(fetch.mock.calls[0]?.[0]).toBe("https://api.567.wiki/v1/images/generations");
		} finally {
			vi.unstubAllGlobals();
			rmSync(root, { recursive: true, force: true });
		}
	});
	it("registers successfully when no image models are available (cold start / unauthenticated)", () => {
		newApiServiceMocks.getAvailableImageModels.mockReturnValue([]);
		newApiServiceMocks.getImageModel.mockReturnValue("gemini-3.1-flash-image");

		const store = new MediaArtifactStore();
		const provider = create567ApiImageProvider(store);
		const descriptor = provider.descriptor;
		const capability = descriptor.capabilities[0];
		expect(capability.operation).toBe("generate");
		if (capability.operation !== "generate") return;

		// 必须不声明 defaultModelId 与 models，避免触发 MediaProviderRegistry 校验异常
		expect(capability.defaultModelId).toBeUndefined();
		expect(capability.models).toBeUndefined();

		const logger = { info: vi.fn(), warn: vi.fn() };
		const registry = new MediaProviderRegistry(new JobManager(), logger);

		// 核心断言：在无模型目录下注册不会抛出 "Media provider default model requires a model catalog"
		expect(() => registry.registerProvider(provider)).not.toThrow();
	});

	it("registers successfully with declared models and matching defaultModelId", () => {
		newApiServiceMocks.getAvailableImageModels.mockReturnValue([
			{ id: "flux-schnell", displayName: "Flux Schnell · 默认", modes: ["text-to-image"] },
			{
				id: "gemini-3.1-flash-image",
				displayName: "Gemini Image · 画图",
				modes: ["text-to-image", "image-to-image"],
			},
		]);
		newApiServiceMocks.getImageModel.mockReturnValue("gemini-3.1-flash-image");

		const store = new MediaArtifactStore();
		const provider = create567ApiImageProvider(store);
		const descriptor = provider.descriptor;

		const capability = descriptor.capabilities[0];
		if (capability.operation !== "generate") return;
		expect(capability.defaultModelId).toBe("gemini-3.1-flash-image");
		expect(capability.models).toHaveLength(2);

		const logger = { info: vi.fn(), warn: vi.fn() };
		const registry = new MediaProviderRegistry(new JobManager(), logger);

		expect(() => registry.registerProvider(provider)).not.toThrow();
	});

	it("falls back to first model if configured model is not in available models", () => {
		newApiServiceMocks.getAvailableImageModels.mockReturnValue([
			{ id: "flux-schnell", displayName: "Flux Schnell · 默认", modes: ["text-to-image"] },
		]);
		newApiServiceMocks.getImageModel.mockReturnValue("non-existent-model");

		const store = new MediaArtifactStore();
		const provider = create567ApiImageProvider(store);
		const descriptor = provider.descriptor;

		const capability = descriptor.capabilities[0];
		if (capability.operation !== "generate") return;
		expect(capability.defaultModelId).toBe("flux-schnell");

		const logger = { info: vi.fn(), warn: vi.fn() };
		const registry = new MediaProviderRegistry(new JobManager(), logger);

		expect(() => registry.registerProvider(provider)).not.toThrow();
	});
});
