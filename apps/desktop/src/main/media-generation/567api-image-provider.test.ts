import { describe, expect, it, vi } from "vitest";
import { JobManager } from "../jobs/job-manager.js";
import { create567ApiImageProvider } from "./567api-image-provider.js";
import { MediaArtifactStore } from "./media-artifact-store.js";
import { MediaProviderRegistry } from "./media-provider-registry.js";

const newApiServiceMocks = vi.hoisted(() => ({
	getAvailableImageModels: vi.fn(),
	getImageModel: vi.fn(),
	getImageGroup: vi.fn(),
	getApiKey: vi.fn(),
}));

vi.mock("../567api/newapi-service.js", () => ({
	NewApiService: {
		getInstance: () => newApiServiceMocks,
	},
}));

describe("567ApiImageProvider", () => {
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
