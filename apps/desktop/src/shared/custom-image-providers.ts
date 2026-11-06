export const CUSTOM_IMAGE_PROVIDER_LIMIT = 20;

export interface CustomImageProviderEntry {
	id: string;
	name: string;
	baseUrl: string;
	model: string;
	supportsTextToImage: boolean;
	supportsImageToImage: boolean;
}

export interface CustomImageProviderSummary extends CustomImageProviderEntry {
	hasApiKey: boolean;
}

export interface CustomImageProviderInput extends Omit<CustomImageProviderEntry, "id"> {
	id?: string;
	/** Write only. An empty edit preserves the current key, unless the origin changes. */
	apiKey?: string;
}

export type CustomImageProviderErrorCode =
	| "invalid-name"
	| "invalid-base-url"
	| "invalid-model"
	| "no-capability"
	| "api-key-required"
	| "not-found"
	| "too-many"
	| "secret-storage-unavailable"
	| "store-unavailable";

/** Stable, redacted errors survive Electron's IPC error serialization. */
export type CustomImageProviderResult<T> = { ok: true; value: T } | { ok: false; error: CustomImageProviderErrorCode };
