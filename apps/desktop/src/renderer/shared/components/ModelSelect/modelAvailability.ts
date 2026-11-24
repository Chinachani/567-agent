import type { ModelsConfigData } from "@preload/api";
import type { Api567Status } from "@preload/api-types/567api";
import type { ModelCatalogSyncErrorState } from "@shared/store/model-catalog-atoms";
import { getBuiltinApi567Route } from "@/shared/service-routes";
import type { ModelOption } from "./useModelOptions";

export type ManagedModelAvailabilityStatus =
	| "available"
	| "confirmed-removed"
	| "offline"
	| "disabled"
	| "non-567"
	| "unknown";

export interface ManagedModelAvailabilityResult {
	readonly status: ManagedModelAvailabilityStatus;
	readonly modelId: string;
	readonly displayName: string;
}

function extractModelLabel(modelKey: string): string {
	const slash = modelKey.indexOf("/");
	return slash > 0 ? modelKey.slice(slash + 1) : modelKey;
}

function getTrusted567Origins(api567Status: Api567Status): string[] {
	const origins = new Set<string>();
	for (const route of api567Status.serviceRoutes?.routes ?? []) {
		if (route.origin) origins.add(route.origin);
	}
	return Array.from(origins);
}

export function isManaged567ProviderInRenderer(
	providerId: string,
	provider: ModelsConfigData["providers"][string] | undefined,
	api567Status: Api567Status,
): boolean {
	if (providerId !== "567api" && !providerId.startsWith("567api_")) return false;
	if (!provider || provider.source === "template") return false;
	if (provider.baseUrl !== undefined) {
		return getBuiltinApi567Route(provider.baseUrl, getTrusted567Origins(api567Status)) !== undefined;
	}
	return true;
}

/**
 * Evaluates whether an explicit `modelKey` is credibly confirmed discontinued on 567 API.
 * Custom/non-567 providers, locally disabled providers, and offline/unverified states
 * never produce `"confirmed-removed"`.
 */
export function assessModelAvailability(params: {
	readonly modelKey: string | null | undefined;
	readonly config: ModelsConfigData | null;
	readonly options: readonly ModelOption[];
	readonly api567Status: Api567Status;
}): ManagedModelAvailabilityResult {
	const { modelKey, config, options, api567Status } = params;
	if (!modelKey) {
		return { status: "unknown", modelId: "", displayName: "" };
	}
	const modelId = extractModelLabel(modelKey);
	const matched = options.find((option) => option.key === modelKey);
	if (matched) {
		return { status: "available", modelId: matched.modelId, displayName: matched.displayName };
	}
	if (!config) {
		return { status: "unknown", modelId, displayName: modelId };
	}
	const slash = modelKey.indexOf("/");
	if (slash <= 0) {
		return { status: "non-567", modelId, displayName: modelId };
	}
	const providerId = modelKey.slice(0, slash);
	const provider = config.providers[providerId];
	const displayName = provider?.models?.find((model) => model.id === modelId)?.name || modelId;

	if (provider?.disabled) {
		return { status: "disabled", modelId, displayName };
	}

	const isOfflineForProvider =
		Boolean(api567Status.failedProviderIds?.includes(providerId)) ||
		api567Status.availableGroupsState === "error" ||
		api567Status.modelsRefreshState === "error";

	if (provider) {
		if (!isManaged567ProviderInRenderer(providerId, provider, api567Status)) {
			return { status: "non-567", modelId, displayName };
		}
		if (!api567Status.isLoggedIn) {
			return { status: "unknown", modelId, displayName };
		}
		if (isOfflineForProvider) {
			return { status: "offline", modelId, displayName };
		}
		if (api567Status.confirmedProviderIds?.includes(providerId)) {
			return { status: "confirmed-removed", modelId, displayName };
		}
		return { status: "unknown", modelId, displayName };
	}

	if (providerId !== "567api" && !providerId.startsWith("567api_")) {
		return { status: "non-567", modelId, displayName };
	}
	if (!api567Status.isLoggedIn) {
		return { status: "unknown", modelId, displayName };
	}
	if (isOfflineForProvider) {
		return { status: "offline", modelId, displayName };
	}
	if (api567Status.removedProviderIds?.includes(providerId)) {
		return { status: "confirmed-removed", modelId, displayName };
	}
	if (
		api567Status.availableGroupsState === "loaded" &&
		api567Status.modelsRefreshState === "loaded" &&
		api567Status.availableProviderIds &&
		!api567Status.availableProviderIds.includes(providerId)
	) {
		return { status: "confirmed-removed", modelId, displayName };
	}
	return { status: "unknown", modelId, displayName };
}

export function isCatalogOffline(api567Status: Api567Status, catalogSyncError: ModelCatalogSyncErrorState): boolean {
	if (catalogSyncError.local) return true;
	if (!api567Status.isLoggedIn) return false;
	if (catalogSyncError.remote) return true;
	return (
		api567Status.availableGroupsState === "error" ||
		api567Status.modelsRefreshState === "error" ||
		(api567Status.failedProviderIds?.length ?? 0) > 0
	);
}

export function resolveFallbackModelOption(params: {
	readonly removedKey: string;
	readonly options: readonly ModelOption[];
	readonly defaultKey: string | undefined;
}): ModelOption | null {
	const { removedKey, options, defaultKey } = params;
	if (!defaultKey || defaultKey === removedKey) return null;
	return options.find((option) => option.key === defaultKey) ?? null;
}
