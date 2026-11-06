import { randomUUID } from "node:crypto";
import type { MediaDimensions, MediaFailure, MediaGenerationMode, MediaProviderJob } from "@vetta-org/capability-sdk";
import { MEDIA_PROTOCOL_VERSION } from "@vetta-org/capability-sdk";
import type { MediaArtifactStore } from "./media-artifact-store.js";
import type { MediaHostProviderSubmitInput, MediaProviderRegistration } from "./media-provider-registry.js";

/**
 * 用户自配的「OpenAI 兼容」图片服务（ADR-0156）。
 *
 * 只说一种协议：`POST {baseUrl}/images/generations`（JSON）与 `POST {baseUrl}/images/edits`
 * （multipart）。Base URL 由用户填写并包含版本段（如 `https://api.example.com/v1`）。
 * API Key 只在发请求的这一刻从 `getApiKey` 取出，写进 `Authorization` 头，
 * 不进描述符、不进日志、不进错误信息。
 */

export const CUSTOM_IMAGE_PROVIDER_ID_PREFIX = "custom-openai:";

export interface CustomImageProviderConfig {
	readonly id: string;
	readonly name: string;
	readonly baseUrl: string;
	readonly model: string;
	readonly supportsTextToImage: boolean;
	readonly supportsImageToImage: boolean;
}

export type CustomImageFetch = (url: string, init: RequestInit) => Promise<Response>;

type GenerateInput = Extract<MediaHostProviderSubmitInput, { readonly operation: "generate" }>;

const DEFAULT_SIZE = "1024x1024";
const REQUEST_TIMEOUT_MS = 300_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const ERROR_MESSAGE_MAX_LENGTH = 300;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_JSON_BYTES = 45 * 1024 * 1024;

export function customImageProviderId(id: string): string {
	return `${CUSTOM_IMAGE_PROVIDER_ID_PREFIX}${id}`;
}

function failedJob(error: MediaFailure): MediaProviderJob {
	return { id: randomUUID(), status: "failed", error };
}

function dimensionsToSize(dimensions: MediaDimensions | undefined): string {
	return dimensions ? `${dimensions.width}x${dimensions.height}` : DEFAULT_SIZE;
}

function sniffMime(base64: string): string {
	const header = Buffer.from(base64.slice(0, 24), "base64");
	if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
	if (header[0] === 255 && header[1] === 216 && header[2] === 255) return "image/jpeg";
	if (header.toString("ascii", 0, 4) === "RIFF" && header.toString("ascii", 8, 12) === "WEBP") return "image/webp";
	if (["GIF87a", "GIF89a"].includes(header.toString("ascii", 0, 6))) return "image/gif";
	throw new Error("Unsupported or invalid image data");
}

function extensionForMime(mimeType: string): string {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	if (mimeType === "image/gif") return "gif";
	return "png";
}

function trimBaseUrl(baseUrl: string): string {
	return baseUrl.trim().replace(/\/+$/, "");
}

/** 上游错误文本里若回显了 key 就抹掉，再截断；这段文字会进入工具结果与日志。 */
function redact(text: string, apiKey: string): string {
	const cleaned = apiKey ? text.split(apiKey).join("***") : text;
	return cleaned.length > ERROR_MESSAGE_MAX_LENGTH ? `${cleaned.slice(0, ERROR_MESSAGE_MAX_LENGTH)}…` : cleaned;
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<Buffer> {
	const length = Number(response.headers.get("content-length"));
	if (length > maxBytes) {
		await response.body?.cancel();
		throw new Error("Image service response is too large");
	}
	if (!response.body) return Buffer.alloc(0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				throw new Error("Image service response is too large");
			}
			chunks.push(value);
		}
		return Buffer.concat(chunks, total);
	} finally {
		reader.releaseLock();
	}
}

async function readUpstreamMessage(response: Response, apiKey: string): Promise<string> {
	const fallback = `HTTP ${response.status}`;
	try {
		const text = new TextDecoder().decode(await readBoundedResponse(response, 64 * 1024));
		try {
			const parsed = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
			const message =
				typeof parsed.error === "string"
					? parsed.error
					: typeof parsed.error?.message === "string"
						? parsed.error.message
						: typeof parsed.message === "string"
							? parsed.message
							: undefined;
			if (message) return redact(`${fallback}: ${message}`, apiKey);
		} catch {
			// 非 JSON 正文（如网关的 HTML 错误页）不回显，避免把整页塞给模型
		}
		return fallback;
	} catch {
		return fallback;
	}
}

function httpFailure(status: number, message: string): MediaFailure {
	if (status === 401 || status === 403) return { code: "unauthenticated", message, retryable: false };
	if (status === 400 && /content|policy|safety/i.test(message)) {
		return { code: "content-rejected", message, retryable: false };
	}
	if (status === 400 || status === 404 || status === 422)
		return { code: "invalid-request", message, retryable: false };
	return { code: "provider-failed", message, retryable: status === 429 || status >= 500 };
}

async function downloadImage(
	fetchImpl: CustomImageFetch,
	imageUrl: string,
	baseUrl: string,
	apiKey: string,
	signal: AbortSignal,
): Promise<{ base64: string; mimeType: string }> {
	const target = new URL(imageUrl, `${baseUrl}/`);
	if ((target.protocol !== "https:" && target.protocol !== "http:") || target.username || target.password) {
		throw new Error("Image URL must use http or https");
	}
	// 只在同源时带 Authorization，避免把 key 发给图片 CDN 等第三方域名。
	const sameOrigin = target.origin === new URL(baseUrl).origin;
	const response = await fetchImpl(target.toString(), {
		method: "GET",
		redirect: "error",
		headers: sameOrigin ? { Authorization: `Bearer ${apiKey}` } : {},
		signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)]),
	});
	if (!response.ok) throw new Error(`Image download returned HTTP ${response.status}`);
	const bytes = await readBoundedResponse(response, MAX_IMAGE_BYTES);
	const base64 = bytes.toString("base64");
	return { base64, mimeType: sniffMime(base64) };
}

async function runGenerate(
	artifacts: MediaArtifactStore,
	fetchImpl: CustomImageFetch,
	config: CustomImageProviderConfig,
	apiKey: string,
	ownerId: string,
	input: GenerateInput,
	signal: AbortSignal,
): Promise<MediaProviderJob> {
	const mode: MediaGenerationMode = input.mode;
	const baseUrl = trimBaseUrl(config.baseUrl);
	const model = input.modelId ?? config.model;
	const size = dimensionsToSize(input.dimensions);
	const headers = { Authorization: `Bearer ${apiKey}` };
	const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);

	let response: Response;
	if (mode === "image-to-image") {
		const source = input.inputs[0];
		if (input.inputs.length !== 1 || source?.kind !== "image") {
			return failedJob({
				code: "invalid-request",
				message: "Image editing requires exactly one image",
				retryable: false,
			});
		}
		const file = await artifacts.resolveInputFile(source);
		if (file.sizeBytes > MAX_IMAGE_BYTES) throw new Error("Reference image exceeds 32 MiB");
		const resolved = await artifacts.resolveInput(source);
		if (resolved.data.length > MAX_IMAGE_BYTES) throw new Error("Reference image exceeds 32 MiB");
		const form = new FormData();
		form.set("model", model);
		form.set("prompt", input.prompt);
		form.set("n", "1");
		form.set("size", size);
		form.set(
			"image",
			new Blob([new Uint8Array(resolved.data)], { type: resolved.mimeType }),
			`image.${extensionForMime(resolved.mimeType)}`,
		);
		response = await fetchImpl(`${baseUrl}/images/edits`, {
			method: "POST",
			redirect: "error",
			headers,
			body: form,
			signal: requestSignal,
		});
	} else {
		if (input.inputs.length !== 0) {
			return failedJob({
				code: "invalid-request",
				message: "Text-to-image does not accept references",
				retryable: false,
			});
		}
		response = await fetchImpl(`${baseUrl}/images/generations`, {
			method: "POST",
			redirect: "error",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify({ model, prompt: input.prompt, n: 1, size }),
			signal: requestSignal,
		});
	}

	if (!response.ok) {
		return failedJob(httpFailure(response.status, await readUpstreamMessage(response, apiKey)));
	}
	const payload: unknown = JSON.parse(new TextDecoder().decode(await readBoundedResponse(response, MAX_JSON_BYTES)));
	const candidate: unknown =
		payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data)
			? payload.data[0]
			: undefined;
	const item = candidate && typeof candidate === "object" ? candidate : undefined;
	let base64: string | undefined;
	let mimeType: string | undefined;
	if (item && "b64_json" in item && typeof item.b64_json === "string" && item.b64_json.length > 0) {
		if (
			item.b64_json.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
			item.b64_json.length % 4 === 1 ||
			!/^[A-Za-z0-9+/]*={0,2}$/.test(item.b64_json) ||
			Buffer.from(item.b64_json, "base64").length > MAX_IMAGE_BYTES
		)
			throw new Error("Invalid or oversized image data");
		base64 = item.b64_json;
		mimeType = sniffMime(base64);
	} else if (item && "url" in item && typeof item.url === "string" && item.url.length > 0) {
		({ base64, mimeType } = await downloadImage(fetchImpl, item.url, baseUrl, apiKey, signal));
	}
	if (!base64 || !mimeType) {
		return failedJob({
			code: "provider-failed",
			message: "The image service response did not include image data",
			retryable: false,
		});
	}
	signal.throwIfAborted();
	const match = /^(\d+)x(\d+)$/.exec(size);
	const artifact = await artifacts.putBase64(ownerId, base64, {
		kind: "image",
		mimeType,
		...(match && input.dimensions ? { width: Number(match[1]), height: Number(match[2]) } : {}),
	});
	return { id: randomUUID(), status: "succeeded", progress: 1, artifacts: [artifact] };
}

export function createOpenAiCompatibleImageProvider(
	artifacts: MediaArtifactStore,
	config: CustomImageProviderConfig,
	getApiKey: () => string | undefined,
	fetchImpl: CustomImageFetch,
): MediaProviderRegistration {
	const modes: MediaGenerationMode[] = [
		...(config.supportsTextToImage ? (["text-to-image"] as const) : []),
		...(config.supportsImageToImage ? (["image-to-image"] as const) : []),
	];
	return {
		descriptor: {
			id: customImageProviderId(config.id),
			ownerId: "desktop-app",
			displayName: config.name,
			protocolVersion: MEDIA_PROTOCOL_VERSION,
			capabilities: [
				{
					operation: "generate",
					kind: "image",
					modes,
					models: [
						{
							id: config.model,
							displayName: config.model,
							sourceDisplayName: config.name,
							modes,
						},
					],
					defaultModelId: config.model,
				},
			],
		},
		submit: async (input, context) => {
			if (input.operation !== "generate") {
				return failedJob({
					code: "operation-unsupported",
					message: `${config.name} does not support ${input.operation}`,
					retryable: false,
				});
			}
			const apiKey = getApiKey();
			if (!apiKey) {
				return failedJob({
					code: "unauthenticated",
					message: `The API key for image service "${config.name}" is not available. Re-enter it in Settings → Models → Images.`,
					retryable: false,
				});
			}
			try {
				return await runGenerate(artifacts, fetchImpl, config, apiKey, context.ownerId, input, context.signal);
			} catch (error) {
				if (context.signal.aborted) throw error;
				const message = "Image request failed or response was invalid";
				const timedOut = error instanceof Error && error.name === "TimeoutError";
				return failedJob({
					code: timedOut ? "provider-timeout" : "provider-failed",
					message: redact(timedOut ? "Image request timed out" : message, apiKey),
					retryable: true,
				});
			}
		},
	};
}
