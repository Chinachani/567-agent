import { randomUUID } from "node:crypto";
import type { MediaDimensions, MediaProviderDescriptor } from "@vetta-org/capability-sdk";
import { MEDIA_PROTOCOL_VERSION } from "@vetta-org/capability-sdk";
import { NewApiService } from "../567api/newapi-service.js";
import { getAppLogger } from "../logger.js";
import type { MediaArtifactStore } from "./media-artifact-store.js";
import type { MediaHostProviderSubmitInput, MediaProviderRegistration } from "./media-provider-registry.js";

const log = getAppLogger("567api-image");

const DEFAULT_SIZE = "1024x1024";

function dimensionsToSize(dimensions: MediaDimensions | undefined): string {
	return dimensions ? `${dimensions.width}x${dimensions.height}` : DEFAULT_SIZE;
}

function dimensionsFromSize(size: string | undefined): MediaDimensions | undefined {
	const match = size ? /^(\d+)x(\d+)$/.exec(size) : null;
	if (!match) return undefined;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? { width, height } : undefined;
}

export function create567ApiImageProvider(
	artifacts: MediaArtifactStore,
	providerId = "desktop-app:api567",
): MediaProviderRegistration {
	return {
		get descriptor(): MediaProviderDescriptor {
			const service = NewApiService.getInstance();
			const imageModels = service.getAvailableImageModels();
			return {
				id: providerId,
				displayName: "567 API",
				ownerId: "desktop-app",
				protocolVersion: MEDIA_PROTOCOL_VERSION,
				capabilities: [
					{
						operation: "generate",
						kind: "image",
						modes: ["text-to-image", "image-to-image"],
						aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4"],
						defaultModelId: service.getImageModel(),
						models:
							imageModels.length > 0
								? imageModels.map((m) => ({
										id: m.id,
										displayName: m.displayName,
										modes: m.modes,
									}))
								: undefined,
					},
				],
			};
		},
		submit: async (input: MediaHostProviderSubmitInput, context) => {
			if (input.operation !== "generate") {
				return {
					id: randomUUID(),
					status: "failed",
					error: {
						code: "operation-unsupported",
						message: `567 API image provider does not support ${input.operation}`,
						retryable: false,
					},
				};
			}

			const service = NewApiService.getInstance();
			const targetGroup = service.getImageGroup();
			let apiKey: string | undefined;
			if (targetGroup) {
				try {
					apiKey = await service.getApiKey(targetGroup);
					log.info(`Using 567 API image group: "${targetGroup}"`);
				} catch (err) {
					log.warn(`Failed to get API key for image group "${targetGroup}":`, err);
				}
			}
			if (!apiKey) {
				try {
					apiKey = await service.getApiKey();
				} catch {
					apiKey = undefined;
				}
			}

			if (!apiKey) {
				return {
					id: randomUUID(),
					status: "failed",
					error: {
						code: "unauthenticated",
						message: "未登录 567 API 或未配置图像生成密钥，请在 567 API 中登录",
						retryable: false,
					},
				};
			}

			const selectedModel = input.modelId || service.getImageModel();
			if (!selectedModel) {
				return {
					id: randomUUID(),
					status: "failed",
					error: {
						code: "provider-failed",
						message:
							"当前画图分组下未检测到可用画图模型，请在「模型设置」中接入画图分组或在「Agent 配置」中选择画图模型",
						retryable: false,
					},
				};
			}

			const requestedSize = dimensionsToSize(input.dimensions);
			try {
				log.info(
					`Generating image via 567 API, model=${selectedModel}, size=${requestedSize}, promptLength=${input.prompt.length}`,
				);
				const res = await fetch("https://api.567.wiki/v1/images/generations", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify({
						prompt: input.prompt,
						model: selectedModel,
						n: 1,
						size: requestedSize,
						response_format: "b64_json",
					}),
					signal: context.signal,
				});

				const rawText = await res.text();
				let json: { data?: Array<{ b64_json?: string; url?: string }>; error?: { message?: string } } | undefined;
				try {
					json = JSON.parse(rawText) as {
						data?: Array<{ b64_json?: string; url?: string }>;
						error?: { message?: string };
					};
				} catch {
					json = undefined;
				}

				if (!res.ok || !json?.data || !json.data[0]) {
					const errorMsg = json?.error?.message || `HTTP ${res.status}: ${rawText.slice(0, 300)}`;
					log.warn("567 API image generation failed:", errorMsg);
					return {
						id: randomUUID(),
						status: "failed",
						error: {
							code: "provider-failed",
							message: errorMsg,
							retryable: res.status >= 500,
						},
					};
				}

				const item = json.data[0];
				let base64Data = item.b64_json;
				if (!base64Data && item.url) {
					const imgRes = await fetch(item.url);
					const buf = Buffer.from(await imgRes.arrayBuffer());
					base64Data = buf.toString("base64");
				}

				if (!base64Data) {
					throw new Error("No image data returned from 567 API");
				}

				const artifact = await artifacts.putBase64(context.ownerId, base64Data, {
					kind: "image",
					mimeType: "image/png",
					...dimensionsFromSize(requestedSize),
				});

				return {
					id: randomUUID(),
					status: "succeeded",
					progress: 1,
					artifacts: [artifact],
				};
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				log.warn("567 API image generation request error:", err);
				return {
					id: randomUUID(),
					status: "failed",
					error: {
						code: "provider-failed",
						message: msg,
						retryable: true,
					},
				};
			}
		},
	};
}
