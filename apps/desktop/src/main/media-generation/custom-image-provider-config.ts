import {
	CUSTOM_IMAGE_PROVIDER_LIMIT,
	type CustomImageProviderEntry,
	type CustomImageProviderErrorCode,
	type CustomImageProviderInput,
} from "../../shared/custom-image-providers.js";

export class CustomImageProviderError extends Error {
	constructor(
		readonly code: CustomImageProviderErrorCode,
		message: string,
	) {
		super(message);
		this.name = "CustomImageProviderError";
	}
}

export function normalizeImageBaseUrl(value: string): string {
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		throw new CustomImageProviderError("invalid-base-url", "Invalid Base URL");
	}
	if (
		value.length > 2048 ||
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new CustomImageProviderError(
			"invalid-base-url",
			"Base URL must use http/https without credentials, query or fragment",
		);
	}
	return url.toString().replace(/\/+$/, "");
}

export function isCustomImageProviderId(value: unknown): value is string {
	return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
}

export function parseCustomImageProviderInput(value: unknown): CustomImageProviderInput {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new CustomImageProviderError("invalid-name", "Invalid image service");
	const raw = value as Record<string, unknown>;
	if (raw.id !== undefined && !isCustomImageProviderId(raw.id))
		throw new CustomImageProviderError("not-found", "Invalid service ID");
	if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.trim().length > 64)
		throw new CustomImageProviderError("invalid-name", "Name is required (max 64 characters)");
	if (typeof raw.model !== "string" || !raw.model.trim() || raw.model.trim().length > 128)
		throw new CustomImageProviderError("invalid-model", "Model name is required (max 128 characters)");
	if (typeof raw.baseUrl !== "string") throw new CustomImageProviderError("invalid-base-url", "Invalid Base URL");
	if (
		typeof raw.supportsTextToImage !== "boolean" ||
		typeof raw.supportsImageToImage !== "boolean" ||
		(!raw.supportsTextToImage && !raw.supportsImageToImage)
	)
		throw new CustomImageProviderError("no-capability", "Select at least one generation mode");
	if (
		raw.apiKey !== undefined &&
		(typeof raw.apiKey !== "string" || raw.apiKey.length > 8192 || /[\r\n\u0000]/.test(raw.apiKey))
	)
		throw new CustomImageProviderError("api-key-required", "Invalid API key");
	return {
		...(isCustomImageProviderId(raw.id) ? { id: raw.id } : {}),
		name: raw.name.trim(),
		model: raw.model.trim(),
		baseUrl: normalizeImageBaseUrl(raw.baseUrl),
		supportsTextToImage: raw.supportsTextToImage,
		supportsImageToImage: raw.supportsImageToImage,
		...(typeof raw.apiKey === "string" ? { apiKey: raw.apiKey.trim() } : {}),
	};
}

export interface StoredImageProvider extends CustomImageProviderEntry {
	/** Rotating a secret writes a new reference before committing metadata. */
	credentialName: string;
}

export function parseStoredImageProviders(value: unknown): StoredImageProvider[] {
	if (
		!value ||
		typeof value !== "object" ||
		!("schemaVersion" in value) ||
		value.schemaVersion !== 1 ||
		!("providers" in value) ||
		!Array.isArray(value.providers) ||
		value.providers.length > CUSTOM_IMAGE_PROVIDER_LIMIT
	)
		throw new Error("Invalid image service store");
	const ids = new Set<string>();
	return value.providers.map((raw: unknown) => {
		const entry = parseCustomImageProviderInput(raw);
		if (!entry.id || ids.has(entry.id)) throw new Error("Invalid image service identity");
		ids.add(entry.id);
		const credentialName = raw && typeof raw === "object" && "credentialName" in raw ? raw.credentialName : "api-key";
		if (typeof credentialName !== "string" || !/^api-key(?:-[0-9a-f-]{36})?$/.test(credentialName))
			throw new Error("Invalid image credential reference");
		return {
			id: entry.id,
			name: entry.name,
			baseUrl: entry.baseUrl,
			model: entry.model,
			supportsTextToImage: entry.supportsTextToImage,
			supportsImageToImage: entry.supportsImageToImage,
			credentialName,
		};
	});
}
