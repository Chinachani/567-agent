import { getProviderIconForGroup } from "../../shared/api567/group-display.js";
import { isPaymentUnavailable } from "../../shared/api567/payment-failure.js";
import type { Api567BilledSnapshot } from "../../shared/local-usage-log.js";
import { DEFAULT_CHAT_INFERENCE_API } from "../../shared/model-inference-api.js";
import { modelOutputKind } from "../../shared/model-output-kind.js";
import { isAccountResponseRejected } from "./access-token-refresh.js";
import { BilledUsageReader, retryAfter } from "./billed-usage.js";

function getModelScore(id: string): number {
	const lower = id.toLowerCase();
	if (lower === "gemini-3.8-flash-high") return 120;
	if (lower.includes("3.8")) return 100;
	if (lower.includes("3.7")) return 95;
	if (lower.includes("3.5")) return 90;
	if (lower.includes("3-") || lower.includes("3.")) return 85;
	if (lower.includes("2.5")) return 80;
	if (lower.includes("2.0") || lower.includes("2-")) return 75;
	if (lower.includes("4o")) return 70;
	if (lower.includes("r1") || lower.includes("reasoner")) return 65;
	if (lower.includes("deepseek")) return 60;
	return 10;
}

function pickBestModel(models: ModelDefinition[]): ModelDefinition | undefined {
	if (!models || models.length === 0) return undefined;
	const sorted = models
		.filter((model) => modelOutputKind(model.id, model) !== "image-only")
		.sort((a, b) => getModelScore(b.id) - getModelScore(a.id));
	return sorted[0];
}

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { dirname, join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { BrowserWindow } from "electron";
import {
	API567_DISCOVERY_ORIGIN,
	type Api567RouteCatalog,
	type Api567RouteId,
	type Api567RouteProbe,
	parseApi567RouteList,
} from "../../shared/service-routes.js";
import { refreshSharedModelRouting } from "../agent-runtime/host-services.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { mainT } from "../i18n/index.js";
import { getAppLogger } from "../logger.js";
import { enrichModelContexts, parseModelList } from "../models/model-context-metadata.js";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";
import type { ModelDefinition, ModelsConfig } from "../models/model-settings-service.js";
import { listPresetProviders } from "../models/presets/sync.js";
import {
	AccessTokenRefreshCoordinator,
	AccountLoginRejectedError,
	isRefreshCookieRejected,
	RefreshCookieRejectedError,
	refreshWithAccountRecovery,
} from "./access-token-refresh.js";
import { loadAccountCredentials, removeAccountCredentials, saveAccountCredentials } from "./account-credentials.js";
import {
	DEFAULT_IMAGE_MODEL,
	getAccountIdentityKey,
	getProviderIdForGroup,
	isGroupAvailable,
	isImageOnlyGroup,
	isManaged567Provider,
	isValidModelKeyInConfig,
	mergeGroupModelsPreservingManualEdits,
	providerIdForGroupName,
} from "./group-selection.js";
import { PasswordLoginEncryptionError, preparePasswordLogin } from "./password-login.js";
import {
	containsNonAscii,
	decryptSecret,
	encryptSecret,
	getSecurityHeaders,
	isSecureCredentialStorageAvailable,
} from "./security.js";
import { getApi567RouteStore } from "./service-route-store.js";

const log = getAppLogger("567api");

const QUOTA_PER_USD = 500000;
const AVAILABLE_GROUPS_CACHE_TTL_MS = 10 * 60 * 1000;
const BACKGROUND_REFRESH_ERROR_COOLDOWN_MS = 15 * 1000;

function isExplicitAuthenticationFailure(error: unknown): boolean {
	if (error instanceof AccountLoginRejectedError) return true;
	if (error instanceof RefreshCookieRejectedError) return error.status !== 403;
	if (typeof error !== "object" || error === null) return false;
	const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown; cause?: unknown };
	const status = Number(candidate.status ?? candidate.statusCode);
	if (status === 403 || Number(candidate.code) === 403) return false;
	if (status === 401) return true;
	if (
		typeof candidate.code === "string" &&
		/^(?:401|UNAUTHORIZED|AUTHENTICATION_FAILED|INVALID_CREDENTIALS)$/i.test(candidate.code)
	) {
		return true;
	}
	return (
		candidate.cause !== undefined && candidate.cause !== error && isExplicitAuthenticationFailure(candidate.cause)
	);
}

export interface Api567GroupInfo {
	name: string;
	desc: string;
	ratio: number;
	enabled: boolean;
	modelsCount?: number;
	models?: string[];
	imageModels?: string[];
}

export interface Api567Session {
	isLoggedIn: boolean;
	authType?: "access_token" | "account";
	username?: string;
	loginUsername?: string;
	accessToken?: string;
	apiKey?: string;
	quota?: number;
	quotaUsd?: number;
	cookie?: string;
	activeGroup?: string;
	imageGroup?: string;
	imageModel?: string;
	groups?: Api567GroupInfo[];
	availableGroups?: Record<string, { desc: string; ratio: number }>;
	lastUpdated?: string;
	groupsUpdated?: string;
	modelsCount?: number;
}

export interface Api567Status {
	serviceRouteError?: boolean;
	serviceRoute?: Api567RouteId;
	serviceRoutes?: Api567RouteCatalog;
	isLoggedIn: boolean;
	authType?: "access_token" | "account";
	username?: string;
	loginUsername?: string;
	apiKeyMasked?: string;
	quota?: number;
	quotaUsd?: number;
	activeGroup?: string;
	activeModel?: string;
	imageGroup?: string;
	imageModel?: string;
	groups?: Api567GroupInfo[];
	availableGroups?: Record<string, { desc: string; ratio: number }>;
	lastUpdated?: string;
	groupsUpdated?: string;
	availableGroupsState?: "idle" | "loaded" | "error";
	modelsRefreshState?: "idle" | "loaded" | "error";
	confirmedProviderIds?: string[];
	failedProviderIds?: string[];
	removedProviderIds?: string[];
	availableProviderIds?: string[];
	modelsCount?: number;
}

export interface RawNewApiToken {
	id: number;
	name: string;
	key?: string;
	group?: string;
	status: number;
	remain_quota?: number;
	unlimited_quota?: boolean;
}

function getSessionFilePath(): string {
	return join(getAgent567HomePath(), "567api-session.json");
}

interface HttpResponse<T = unknown> {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	data: T;
}

function request<T = unknown>(
	urlStr: string,
	options: {
		method?: string;
		headers?: Record<string, string>;
		body?: unknown;
		timeoutMs?: number;
		signal?: AbortSignal;
		maxBytes?: number;
	} = {},
): Promise<HttpResponse<T>> {
	return new Promise((resolve, reject) => {
		const url = new URL(urlStr);
		const client = url.protocol === "http:" ? http : https;
		const postBody = options.body
			? typeof options.body === "string"
				? options.body
				: JSON.stringify(options.body)
			: null;

		const headers: Record<string, string> = {
			"User-Agent": "567-Agent-Desktop/1.0",
			...getSecurityHeaders(),
			...(postBody
				? {
						"Content-Type": "application/json",
						"Content-Length": String(Buffer.byteLength(postBody)),
					}
				: {}),
			...options.headers,
		};

		const req = client.request(
			url,
			{
				method: options.method || "GET",
				headers,
				timeout: options.timeoutMs ?? 15000,
				signal: options.signal,
			},
			(res) => {
				let raw = "";
				res.setEncoding("utf8");
				res.on("error", reject);
				res.on("data", (chunk) => {
					raw += chunk;
					if (options.maxBytes && Buffer.byteLength(raw) > options.maxBytes)
						req.destroy(new Error("Response too large"));
				});
				res.on("end", () => {
					let parsed: T;
					try {
						parsed = JSON.parse(raw) as T;
					} catch {
						parsed = raw as unknown as T;
					}
					resolve({
						status: res.statusCode || 0,
						headers: res.headers,
						data: parsed,
					});
				});
			},
		);

		req.on("timeout", () => {
			req.destroy(new Error("请求超时，请检查网络或 567 API 服务状态"));
		});

		req.on("error", reject);

		if (postBody) {
			req.write(postBody);
		}
		req.end();
	});
}

function extractTokens(data: unknown): RawNewApiToken[] {
	if (!data) return [];
	if (Array.isArray(data)) return data as RawNewApiToken[];
	if (typeof data === "object") {
		const obj = data as Record<string, unknown>;
		if (Array.isArray(obj.items)) return obj.items as RawNewApiToken[];
		if (Array.isArray(obj.data)) return obj.data as RawNewApiToken[];
		if (Array.isArray(obj.tokens)) return obj.tokens as RawNewApiToken[];
		if (obj.data && typeof obj.data === "object") {
			const nested = obj.data as Record<string, unknown>;
			if (Array.isArray(nested.items)) return nested.items as RawNewApiToken[];
			if (Array.isArray(nested.data)) return nested.data as RawNewApiToken[];
		}
	}
	return [];
}

export { getProviderIconForGroup, getProviderIdForGroup };

const NON_CHAT =
	/embedding|embed|whisper|tts|audio|realtime|-live-|moderation|transcribe|rerank|vision-ocr|veo-|lyria|deep-research|computer-use|-character|livetranslate/i;

function fetchPageHtml(urlStr: string, redirectCount = 0): Promise<{ html: string; url: string; status: number }> {
	return new Promise((resolve, reject) => {
		const u = new URL(urlStr);
		const client = u.protocol === "http:" ? http : https;
		const req = client.get(
			u,
			{
				headers: {
					"User-Agent":
						"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
				},
				timeout: 8000,
			},
			(res) => {
				if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
					res.resume();
					if (redirectCount >= 10) {
						return reject(new Error("Too many redirects while fetching payment page"));
					}
					return resolve(fetchPageHtml(new URL(res.headers.location, u).href, redirectCount + 1));
				}
				let raw = "";
				res.setEncoding("utf8");
				res.on("data", (c) => {
					raw += c;
				});
				res.on("end", () => resolve({ html: raw, url: urlStr, status: res.statusCode ?? 0 }));
			},
		);
		req.on("error", reject);
		req.on("timeout", () => req.destroy(new Error("Request timeout")));
	});
}

export class NewApiService {
	private routeChangePending = false;
	private routeDiscovery: Promise<Api567RouteCatalog> | undefined;
	private routeDiscoveryRetryAt = 0;
	public async refreshServiceRoutes(force = false): Promise<Api567RouteCatalog> {
		const store = getApi567RouteStore();
		if (this.routeDiscovery) return this.routeDiscovery;
		const cached = store.catalog;
		if (
			!force &&
			((cached.updatedAt && Date.now() - cached.updatedAt < 5 * 60_000) || Date.now() < this.routeDiscoveryRetryAt)
		)
			return cached;
		this.routeDiscovery = (async () => {
			try {
				const response = await request<unknown>(`${API567_DISCOVERY_ORIGIN}/api/status`, {
					signal: AbortSignal.timeout(8000),
					maxBytes: 128 * 1024,
				});
				const root = response.data;
				if (
					response.status !== 200 ||
					!root ||
					typeof root !== "object" ||
					!("success" in root) ||
					root.success !== true ||
					!("data" in root) ||
					!root.data ||
					typeof root.data !== "object" ||
					!("api_info" in root.data) ||
					("api_info_enabled" in root.data && root.data.api_info_enabled === false)
				)
					throw new Error("Invalid service route response");
				await store.saveCatalog(parseApi567RouteList(root.data.api_info));
				this.routeDiscoveryRetryAt = 0;
				return { ...store.catalog, source: "live" as const };
			} catch {
				this.routeDiscoveryRetryAt = Date.now() + 60_000;
				return { ...store.catalog, refreshFailed: true };
			} finally {
				this.routeDiscovery = undefined;
			}
		})();
		return this.routeDiscovery;
	}
	public getServiceOrigin(): string {
		return getApi567RouteStore().origin;
	}
	private get baseServer(): string {
		return this.getServiceOrigin();
	}
	private get baseV1(): string {
		return `${this.baseServer}/v1`;
	}

	public async probeServiceRoute(route: Api567RouteId, signal?: AbortSignal): Promise<Api567RouteProbe> {
		const target = getApi567RouteStore().resolve(route);
		if (!target) return { route, ok: false, error: "unavailable" };
		const start = performance.now();
		try {
			const response = await request<{ success?: boolean }>(`${target.origin}/api/status`, {
				signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
				maxBytes: 64 * 1024,
			});
			if (response.status !== 200 || response.data?.success !== true)
				return { route, ok: false, error: "invalid-response" };
			return { route, ok: true, elapsedMs: Math.round(performance.now() - start) };
		} catch {
			return { route, ok: false, error: "unreachable" };
		}
	}

	public async selectServiceRoute(route: Api567RouteId, signal?: AbortSignal): Promise<Api567RouteProbe> {
		if (this.routeChangePending) return { route, ok: false, error: "unavailable" };
		this.routeChangePending = true;
		try {
			const target = getApi567RouteStore().resolve(route);
			if (!target) return { route, ok: false, error: "unavailable" };
			const token = this.currentSession.accessToken;
			const cookie = this.currentSession.cookie;
			const loggedIn = this.currentSession.isLoggedIn;
			const probe = await this.probeServiceRoute(route, signal);
			if (!probe.ok) return probe;
			if (this.preservedEncryptedSession || (loggedIn && !token)) return { route, ok: false, error: "unavailable" };
			if (loggedIn) {
				const response = await request<{ success?: boolean }>(`${target.origin}/api/user/self`, {
					headers: { Authorization: `Bearer ${token}` },
					signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
					maxBytes: 128 * 1024,
				});
				if (response.status !== 200 || response.data?.success !== true)
					return { route, ok: false, error: "account-rejected" };
			}
			if (signal?.aborted) return { route, ok: false, error: "unavailable" };
			if (
				this.currentSession.accessToken !== token ||
				this.currentSession.cookie !== cookie ||
				this.currentSession.isLoggedIn !== loggedIn
			) {
				return { route, ok: false, error: "account-changed" };
			}
			await getApi567RouteStore().select(route);
			this.resetAccountRuntimeState();
			try {
				refreshSharedModelRouting();
				await this.broadcastStatus();
			} catch (error) {
				// The route is already durable. Future catalog reads also refresh it;
				// a UI notification failure must not claim the configuration was kept.
				log.warn("Service route saved; immediate notification failed", error);
			}
			return probe;
		} catch (error) {
			log.warn("Service route switch failed; keeping current configuration", error);
			return { route, ok: false, error: "unreachable" };
		} finally {
			this.routeChangePending = false;
		}
	}
	private static instance: NewApiService;
	private currentSession: Api567Session = { isLoggedIn: false };
	private preservedEncryptedSession = false;
	private rateLimitedUntil = 0;
	private readonly accessTokenRefresh = new AccessTokenRefreshCoordinator();
	private refreshQuotaPromise: Promise<{ success: boolean; quota?: number; quotaUsd?: number }> | null = null;
	private accountGeneration = 0;
	private billedUsage = new BilledUsageReader();
	private billingRate?: { until: number; limitedUntil?: number; pending?: Promise<number | undefined> };
	private groupsFetchFailed = false;
	private availableGroupsInFlight: {
		gen: number;
		force: boolean;
		promise: Promise<Record<string, { desc: string; ratio: number }>>;
	} | null = null;
	private backgroundRefreshInFlight: {
		gen: number;
		promise: Promise<{ refreshed: boolean; success: boolean }>;
	} | null = null;
	private startupBackgroundRefreshedGen = -1;
	private lastBackgroundRefreshErrorAt = 0;
	private readonly confirmedModelProviderIds = new Set<string>();
	private readonly failedModelProviderIds = new Set<string>();
	private readonly removedModelProviderIds = new Set<string>();

	private constructor() {
		this.loadSession();
		setInterval(
			() => {
				if (this.currentSession.isLoggedIn) {
					void this.refreshQuota(false);
				}
			},
			5 * 60 * 1000,
		);
	}

	public static getInstance(): NewApiService {
		if (!NewApiService.instance) {
			NewApiService.instance = new NewApiService();
		}
		return NewApiService.instance;
	}

	private getTrustedOrigins(): string[] {
		try {
			return getApi567RouteStore().trustedOrigins;
		} catch {
			return [];
		}
	}

	private async mutateModelConfig(
		mutate: (current: ModelsConfig) => ModelsConfig | null | Promise<ModelsConfig | null>,
	): Promise<boolean> {
		const service = getDesktopModelSettingsService() as {
			getConfig: () => Promise<ModelsConfig>;
			replaceConfig: (config: ModelsConfig) => Promise<void>;
			updateConfig?: (
				fn: (current: ModelsConfig) => ModelsConfig | null | Promise<ModelsConfig | null>,
			) => Promise<boolean>;
		};
		if (typeof service.updateConfig === "function") {
			return service.updateConfig(mutate);
		}
		const current = await service.getConfig();
		const next = await mutate(current);
		if (!next) return false;
		await service.replaceConfig(next);
		return true;
	}

	private resetAccountRuntimeState(): void {
		this.accountGeneration += 1;
		this.billedUsage = new BilledUsageReader();
		this.billingRate = undefined;
		this.groupsFetchFailed = false;
		this.availableGroupsInFlight = null;
		this.backgroundRefreshInFlight = null;
		this.startupBackgroundRefreshedGen = -1;
		this.lastBackgroundRefreshErrorAt = 0;
		this.confirmedModelProviderIds.clear();
		this.failedModelProviderIds.clear();
		this.removedModelProviderIds.clear();
	}

	private getModelsRefreshState(): "idle" | "loaded" | "error" {
		if (!this.currentSession.isLoggedIn) return "idle";
		if (this.groupsFetchFailed || this.failedModelProviderIds.size > 0 || this.lastBackgroundRefreshErrorAt > 0) {
			return "error";
		}
		if (
			this.confirmedModelProviderIds.size > 0 ||
			this.removedModelProviderIds.size > 0 ||
			this.hasConfirmedAvailableGroups()
		) {
			return "loaded";
		}
		return "idle";
	}

	private hasConfirmedAvailableGroups(): boolean {
		return this.currentSession.groupsUpdated !== undefined && this.currentSession.availableGroups !== undefined;
	}

	private getAvailableGroupsState(): "idle" | "loaded" | "error" {
		if (!this.currentSession.isLoggedIn) return "idle";
		if (this.groupsFetchFailed) return "error";
		if (
			this.hasConfirmedAvailableGroups() ||
			(this.currentSession.availableGroups !== undefined &&
				Object.keys(this.currentSession.availableGroups).length > 0)
		) {
			return "loaded";
		}
		return "idle";
	}

	private async clearManagedProvidersFromConfig(): Promise<void> {
		const trustedOrigins = this.getTrustedOrigins();
		await this.mutateModelConfig((config) => {
			const deletedIds = new Set<string>();
			for (const id of Object.keys(config.providers)) {
				if (isManaged567Provider(id, config.providers[id], trustedOrigins)) {
					delete config.providers[id];
					deletedIds.add(id);
				}
			}
			if (deletedIds.size === 0) return null;
			if (config.defaultModel) {
				const slash = config.defaultModel.indexOf("/");
				const defaultProviderId = slash > 0 ? config.defaultModel.slice(0, slash) : undefined;
				if (defaultProviderId && deletedIds.has(defaultProviderId)) {
					delete config.defaultModel;
				}
			}
			return config;
		});
	}

	public async getStatus(): Promise<Api567Status> {
		const routes = getApi567RouteStore();
		if (!routes.selectedRoute) return { isLoggedIn: false, serviceRouteError: true, serviceRoutes: routes.catalog };
		const activeModel = await this.reconcileWithModelConfig();
		const availableGroupsState = this.getAvailableGroupsState();
		const modelsRefreshState = this.getModelsRefreshState();
		const availableProviderIds = this.hasConfirmedAvailableGroups()
			? Array.from(
					new Set(
						Object.keys(this.currentSession.availableGroups ?? {}).map((name) => providerIdForGroupName(name)),
					),
				)
			: undefined;
		return {
			serviceRoute: getApi567RouteStore().route,
			serviceRoutes: getApi567RouteStore().catalog,
			isLoggedIn: this.currentSession.isLoggedIn,
			authType: this.currentSession.authType,
			username: this.currentSession.username,
			loginUsername: this.currentSession.loginUsername,
			apiKeyMasked: this.currentSession.apiKey
				? `${this.currentSession.apiKey.slice(0, 7)}...${this.currentSession.apiKey.slice(-4)}`
				: undefined,
			quota: this.currentSession.quota,
			quotaUsd: this.currentSession.quotaUsd,
			activeGroup: this.currentSession.activeGroup,
			activeModel,
			imageGroup: this.getImageGroup(),
			imageModel: this.getImageModel(),
			groups: this.currentSession.groups,
			availableGroups: this.currentSession.availableGroups,
			lastUpdated: this.currentSession.lastUpdated,
			groupsUpdated: this.currentSession.groupsUpdated,
			availableGroupsState,
			modelsRefreshState,
			confirmedProviderIds: Array.from(this.confirmedModelProviderIds),
			failedProviderIds: Array.from(this.failedModelProviderIds),
			removedProviderIds: Array.from(this.removedModelProviderIds),
			...(availableProviderIds ? { availableProviderIds } : {}),
			modelsCount: this.currentSession.modelsCount,
		};
	}

	public getImageGroup(): string | undefined {
		const available = this.currentSession.availableGroups || {};
		const confirmedAvailable = this.hasConfirmedAvailableGroups();
		if (this.currentSession.imageGroup) {
			if (!confirmedAvailable || isGroupAvailable(available, this.currentSession.imageGroup)) {
				return this.currentSession.imageGroup;
			}
		}
		return undefined;
	}

	public getImageModel(): string | undefined {
		const currentImgGroup = this.getImageGroup();
		if (!currentImgGroup) return undefined;
		const matchedGroup = this.currentSession.groups?.find((g) => g.name === currentImgGroup);
		if (matchedGroup?.imageModels !== undefined) {
			if (matchedGroup.imageModels.length === 0) {
				return undefined;
			}
			if (this.currentSession.imageModel && matchedGroup.imageModels.includes(this.currentSession.imageModel)) {
				return this.currentSession.imageModel;
			}
			if (matchedGroup.imageModels.includes(DEFAULT_IMAGE_MODEL)) {
				return DEFAULT_IMAGE_MODEL;
			}
			return matchedGroup.imageModels[0];
		}
		if (this.currentSession.imageModel) {
			return this.currentSession.imageModel;
		}
		return currentImgGroup ? DEFAULT_IMAGE_MODEL : undefined;
	}

	public async setImageGroup(groupName: string): Promise<{ success: boolean; message?: string }> {
		if (this.preservedEncryptedSession && !this.currentSession.accessToken) {
			return { success: false, message: "凭据暂时无法解密，图像设置未保存；请恢复系统密钥环后重启应用" };
		}
		const generation = this.accountGeneration;
		if (
			!this.currentSession.isLoggedIn ||
			(this.hasConfirmedAvailableGroups() && !isGroupAvailable(this.currentSession.availableGroups ?? {}, groupName))
		)
			return { success: false, message: mainT("api567Model.groupUnavailable") };
		if (!this.currentSession.groups?.some((g) => g.name === groupName)) {
			const result = await this.syncSingleGroup(groupName);
			if (!result.success || generation !== this.accountGeneration)
				return { success: false, message: result.message ?? mainT("api567Model.groupUnavailable") };
		}
		if (this.currentSession.imageGroup !== groupName) this.currentSession.imageModel = undefined;
		this.currentSession.imageGroup = groupName;
		this.saveSession(this.currentSession);
		log.info(`567api image group set to: ${groupName}`);
		return { success: true };
	}

	public async setImageModel(modelName: string): Promise<{ success: boolean; message?: string }> {
		if (this.preservedEncryptedSession && !this.currentSession.accessToken) {
			return { success: false, message: "凭据暂时无法解密，图像设置未保存；请恢复系统密钥环后重启应用" };
		}
		this.currentSession.imageModel = modelName;
		this.saveSession(this.currentSession);
		log.info(`567api image model set to: ${modelName}`);
		return { success: true };
	}

	public getAvailableImageModels(): Array<{
		id: string;
		displayName: string;
		modes: ("text-to-image" | "image-to-image")[];
	}> {
		const result = new Map<
			string,
			{ id: string; displayName: string; modes: ("text-to-image" | "image-to-image")[] }
		>();

		// 1. 如果有配置画图专属分组，优先注入该分组里的所有生图模型
		const currentImgGroup = this.getImageGroup();
		const matchedGroup = this.currentSession.groups?.find((g) => g.name === currentImgGroup);
		if (matchedGroup?.imageModels && matchedGroup.imageModels.length > 0) {
			for (const mId of matchedGroup.imageModels) {
				result.set(mId, {
					id: mId,
					displayName: `${mId} · ${matchedGroup.name}`,
					modes: ["text-to-image", "image-to-image"],
				});
			}
		}

		return Array.from(result.values());
	}

	public async refreshSyncedGroups(): Promise<{ success: boolean }> {
		const result = await this.refreshGroupsAndModelsInBackground({ force: true });
		return { success: result.success };
	}

	/**
	 * 后台安全刷新可用分组与已接入分组的模型列表（不创建或删除远端 Token，保护手动编辑与其他服务商）。
	 */
	public async refreshGroupsAndModelsInBackground(
		options: { force?: boolean; startup?: boolean } = {},
	): Promise<{ refreshed: boolean; success: boolean }> {
		if (!this.currentSession.isLoggedIn || (this.preservedEncryptedSession && !this.currentSession.accessToken)) {
			return { refreshed: false, success: false };
		}
		const gen = this.accountGeneration;
		if (this.backgroundRefreshInFlight && this.backgroundRefreshInFlight.gen === gen) {
			return this.backgroundRefreshInFlight.promise;
		}
		if (Date.now() < this.rateLimitedUntil) {
			return { refreshed: false, success: false };
		}
		const isStartupBypass = options.startup === true && this.startupBackgroundRefreshedGen !== gen;
		if (!options.force && !isStartupBypass) {
			if (
				this.lastBackgroundRefreshErrorAt &&
				Date.now() - this.lastBackgroundRefreshErrorAt < BACKGROUND_REFRESH_ERROR_COOLDOWN_MS
			) {
				return { refreshed: false, success: false };
			}
		}
		if (isStartupBypass) {
			this.startupBackgroundRefreshedGen = gen;
		}

		const promise = (async (): Promise<{ refreshed: boolean; success: boolean }> => {
			const initialGroupNames = new Set(this.currentSession.groups?.map((group) => group.name));
			let available: Record<string, { desc: string; ratio: number }> = {};
			let groupsOk = false;
			try {
				available = await this.getAvailableGroups(true);
				groupsOk = true;
			} catch (err) {
				log.warn("Background refresh failed to fetch available groups:", err);
			}
			if (this.accountGeneration !== gen || !this.currentSession.isLoggedIn) {
				return { refreshed: false, success: false };
			}

			const trustedOrigins = this.getTrustedOrigins();
			const currentGroups = [...(this.currentSession.groups ?? [])];
			const isGroupStillAvailable = (groupName: string): boolean =>
				!initialGroupNames.has(groupName) || !groupsOk || isGroupAvailable(available, groupName);
			const initialDeletedGroupNames = new Set(
				currentGroups.filter((g) => !isGroupStillAvailable(g.name)).map((g) => g.name),
			);
			const initialRemainingGroups = currentGroups.filter((g) => !initialDeletedGroupNames.has(g.name));

			const snapshot = await getDesktopModelSettingsService().getConfig();
			if (this.accountGeneration !== gen || !this.currentSession.isLoggedIn) {
				return { refreshed: false, success: false };
			}

			const refreshedModels = new Map<
				string,
				{ providerId: string; modelDefs: ModelDefinition[]; imageModelIds: string[] }
			>();
			let anyModelError = false;
			const failedInRun = new Set<string>();
			for (const g of initialRemainingGroups) {
				const providerId = providerIdForGroupName(g.name);
				const provider = snapshot.providers[providerId];
				if (!provider?.apiKey || !isManaged567Provider(providerId, provider, trustedOrigins)) {
					continue;
				}
				const rawName = g.name === "默认分组" ? "" : g.name;
				const res = await this.fetchGroupModelsResult(rawName, provider.apiKey);
				if (this.accountGeneration !== gen || !this.currentSession.isLoggedIn) {
					return { refreshed: false, success: false };
				}
				if (!res.ok) {
					anyModelError = true;
					failedInRun.add(providerId);
					log.warn(`Background refresh skipped updating models for group ${g.name}: ${res.error}`);
					continue;
				}
				refreshedModels.set(g.name, {
					providerId,
					modelDefs: res.modelDefs,
					imageModelIds: res.imageModelIds,
				});
			}

			const preMutateGroups = [...(this.currentSession.groups ?? [])];
			const preMutateDeletedNames = new Set(
				preMutateGroups.filter((g) => !isGroupStillAvailable(g.name)).map((g) => g.name),
			);
			const preMutateSurvivingPids = new Set(
				preMutateGroups
					.filter((g) => !preMutateDeletedNames.has(g.name))
					.map((g) => providerIdForGroupName(g.name)),
			);
			const deletedProviderIds = new Set(
				Array.from(preMutateDeletedNames, (name) => providerIdForGroupName(name)).filter(
					(pid) => !preMutateSurvivingPids.has(pid),
				),
			);
			const appliedGroupNames = new Set<string>();
			const appliedDeletedProviderIds = new Set<string>();
			const appliedRefreshedProviderIds = new Set<string>();
			if (deletedProviderIds.size > 0 || refreshedModels.size > 0) {
				await this.mutateModelConfig((config) => {
					if (this.accountGeneration !== gen || !this.currentSession.isLoggedIn) return null;
					appliedGroupNames.clear();
					appliedDeletedProviderIds.clear();
					appliedRefreshedProviderIds.clear();
					let changed = false;
					const latestSessionGroups = this.currentSession.groups ?? [];
					const currentDeletedNames = new Set(
						latestSessionGroups.filter((g) => !isGroupStillAvailable(g.name)).map((g) => g.name),
					);
					const currentSurvivingGroups = latestSessionGroups.filter((g) => !currentDeletedNames.has(g.name));
					const currentSurvivingGroupMap = new Map(currentSurvivingGroups.map((g) => [g.name, g]));
					const currentSurvivingPids = new Set(currentSurvivingGroups.map((g) => providerIdForGroupName(g.name)));
					const currentDeletedPids = new Set(
						Array.from(currentDeletedNames, (name) => providerIdForGroupName(name)).filter(
							(pid) => !currentSurvivingPids.has(pid),
						),
					);
					const actuallyDeletedProviderIds = new Set<string>();
					for (const pid of currentDeletedPids) {
						if (isManaged567Provider(pid, config.providers[pid], trustedOrigins)) {
							delete config.providers[pid];
							actuallyDeletedProviderIds.add(pid);
							appliedDeletedProviderIds.add(pid);
							changed = true;
						}
					}
					const refreshedProviderIds = new Set<string>();
					for (const [groupName, update] of refreshedModels) {
						const groupMeta = currentSurvivingGroupMap.get(groupName);
						if (!groupMeta) continue;
						const existing = config.providers[update.providerId];
						if (
							!existing?.apiKey ||
							existing.apiKey !== snapshot.providers[update.providerId]?.apiKey ||
							!isManaged567Provider(update.providerId, existing, trustedOrigins)
						) {
							continue;
						}
						refreshedProviderIds.add(update.providerId);
						appliedRefreshedProviderIds.add(update.providerId);
						appliedGroupNames.add(groupName);
						const mergedModels = mergeGroupModelsPreservingManualEdits(update.modelDefs, existing.models);
						const meta = available[groupName] ?? this.currentSession.availableGroups?.[groupName];
						const ratio = meta?.ratio !== undefined ? meta.ratio : (groupMeta?.ratio ?? 1);
						const rawName = groupName === "默认分组" ? "" : groupName;
						const displayName = rawName ? `567 · ${rawName} (${ratio}x)` : "567 API";
						config.providers[update.providerId] = {
							...existing,
							baseUrl: existing.baseUrl ?? this.baseV1,
							displayName,
							icon: existing.icon ?? getProviderIconForGroup(groupName),
							headers: {
								...existing.headers,
								"X-567-Group": encodeURIComponent(rawName || "default"),
							},
							modelsSyncedAt: new Date().toISOString(),
							models: mergedModels,
						};
						changed = true;
					}

					if (config.defaultModel) {
						const slash = config.defaultModel.indexOf("/");
						const defaultProviderId = slash > 0 ? config.defaultModel.slice(0, slash) : undefined;
						const defaultAffected =
							defaultProviderId !== undefined &&
							(actuallyDeletedProviderIds.has(defaultProviderId) || refreshedProviderIds.has(defaultProviderId));
						if (defaultAffected && !isValidModelKeyInConfig(config, config.defaultModel)) {
							const currentProvider = defaultProviderId ? config.providers[defaultProviderId] : undefined;
							const currentCandidate =
								currentProvider && !currentProvider.disabled && currentProvider.models?.length
									? pickBestModel(currentProvider.models)
									: undefined;
							if (currentCandidate && defaultProviderId) {
								config.defaultModel = `${defaultProviderId}/${currentCandidate.id}`;
							} else {
								delete config.defaultModel;
							}
							changed = true;
						}
					}
					return changed ? config : null;
				});
			}

			if (this.accountGeneration !== gen || !this.currentSession.isLoggedIn) {
				return { refreshed: false, success: false };
			}

			const latestSessionGroups = this.currentSession.groups ?? [];
			const finalDeletedGroupNames = new Set(
				latestSessionGroups.filter((g) => !isGroupStillAvailable(g.name)).map((g) => g.name),
			);
			this.currentSession.groups = latestSessionGroups
				.filter((g) => !finalDeletedGroupNames.has(g.name))
				.map((g) => {
					const meta = groupsOk ? available[g.name] : this.currentSession.availableGroups?.[g.name];
					if (!appliedGroupNames.has(g.name)) {
						return meta ? { ...g, desc: meta.desc, ratio: meta.ratio } : g;
					}
					const update = refreshedModels.get(g.name);
					if (!update) {
						return meta ? { ...g, desc: meta.desc, ratio: meta.ratio } : g;
					}
					const modelIds = update.modelDefs.map((m) => m.id);
					return {
						...g,
						desc: meta?.desc ?? g.desc,
						ratio: meta?.ratio ?? g.ratio,
						modelsCount: modelIds.length,
						models: modelIds,
						imageModels: update.imageModelIds,
					};
				});
			if (groupsOk) {
				if (this.currentSession.activeGroup && finalDeletedGroupNames.has(this.currentSession.activeGroup)) {
					this.currentSession.activeGroup = undefined;
				}
				if (this.currentSession.imageGroup && !isGroupAvailable(available, this.currentSession.imageGroup)) {
					this.currentSession.imageGroup = undefined;
					this.currentSession.imageModel = undefined;
				}
			}
			const matchedImageGroup = this.currentSession.groups.find((g) => g.name === this.getImageGroup());
			if (matchedImageGroup?.imageModels !== undefined) {
				if (matchedImageGroup.imageModels.length === 0) {
					this.currentSession.imageModel = undefined;
				} else if (
					!this.currentSession.imageModel ||
					!matchedImageGroup.imageModels.includes(this.currentSession.imageModel)
				) {
					this.currentSession.imageModel = matchedImageGroup.imageModels.includes(DEFAULT_IMAGE_MODEL)
						? DEFAULT_IMAGE_MODEL
						: matchedImageGroup.imageModels[0];
				}
			}

			await this.reconcileWithModelConfig();
			if (this.accountGeneration !== gen || !this.currentSession.isLoggedIn) {
				return { refreshed: false, success: false };
			}
			const ok = groupsOk && !anyModelError;
			if (groupsOk) {
				for (const name of Object.keys(available)) {
					this.removedModelProviderIds.delete(providerIdForGroupName(name));
				}
				for (const pid of appliedDeletedProviderIds) {
					this.removedModelProviderIds.add(pid);
					this.confirmedModelProviderIds.delete(pid);
					this.failedModelProviderIds.delete(pid);
				}
			}
			for (const pid of appliedRefreshedProviderIds) {
				this.confirmedModelProviderIds.add(pid);
				this.failedModelProviderIds.delete(pid);
				this.removedModelProviderIds.delete(pid);
			}
			for (const pid of failedInRun) {
				this.failedModelProviderIds.add(pid);
				this.confirmedModelProviderIds.delete(pid);
			}
			if (ok) {
				this.lastBackgroundRefreshErrorAt = 0;
			} else {
				this.lastBackgroundRefreshErrorAt = Date.now();
			}
			this.saveSession(this.currentSession);
			return { refreshed: true, success: ok };
		})().finally(() => {
			if (this.backgroundRefreshInFlight?.gen === gen) {
				this.backgroundRefreshInFlight = null;
			}
		});

		this.backgroundRefreshInFlight = { gen, promise };
		return promise;
	}

	/**
	 * 发送邮箱验证码
	 */
	public async sendVerificationCode(email: string): Promise<{ success: boolean; message?: string }> {
		const cleanEmail = email.trim();
		if (!cleanEmail) {
			return { success: false, message: "请输入有效的邮箱地址" };
		}
		try {
			log.info(`Sending email verification code to: ${cleanEmail}`);
			const res = await request<{ success: boolean; message?: string }>(
				`${this.baseServer}/api/verification?email=${encodeURIComponent(cleanEmail)}`,
			);
			return {
				success: res.data?.success ?? false,
				message: res.data?.message || (res.data?.success ? "验证码已发送至您的邮箱" : "发送失败，请稍后重试"),
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.warn("Failed to send verification code:", err);
			return { success: false, message: msg };
		}
	}

	/**
	 * 用户账号注册，并在注册成功后自动完成登录
	 */
	public async register(params: {
		username: string;
		password: string;
		email: string;
		verification_code: string;
		aff_code?: string;
	}): Promise<{ success: boolean; message?: string }> {
		const username = params.username.trim();
		const password = params.password.trim();
		const email = params.email.trim();
		const verification_code = params.verification_code.trim();
		const aff_code = params.aff_code?.trim() || undefined;

		if (!username || !password || !email || !verification_code) {
			return { success: false, message: "请完整填写用户名、密码、邮箱及验证码" };
		}

		try {
			log.info(`Registering new user: "${username}" with email "${email}"`);
			const res = await request<{ success: boolean; message?: string }>(`${this.baseServer}/api/user/register`, {
				method: "POST",
				body: {
					username,
					password,
					email,
					verification_code,
					...(aff_code ? { aff_code } : {}),
				},
			});

			if (!res.data?.success) {
				return {
					success: false,
					message: res.data?.message || "注册失败，请检查填写的信息后重试",
				};
			}

			log.info(`Registration succeeded for "${username}", automatically logging in...`);
			return await this.loginWithPassword(username, password);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.warn("Registration failed with error:", err);
			return { success: false, message: msg };
		}
	}

	/**
	 * 卡密兑换充值 (CDKEY)
	 */
	public async topupWithKey(key: string): Promise<{ success: boolean; message?: string }> {
		const cleanKey = key.trim();
		if (!cleanKey) {
			return { success: false, message: "请输入有效的充值兑换码" };
		}
		if (!this.currentSession.isLoggedIn) {
			return { success: false, message: "请先登录 567 API 账户后再进行充值" };
		}
		try {
			log.info("Redeeming topup key...");
			const res = await this.requestWithAuth<{ success: boolean; message?: string }>(
				`${this.baseServer}/api/user/topup`,
				{
					method: "POST",
					body: { key: cleanKey },
				},
			);
			if (res.data?.success) {
				await this.refreshQuota(true);
				return { success: true, message: res.data?.message || "兑换成功！额度已到账" };
			}
			return { success: false, message: res.data?.message || "兑换失败，请检查卡密是否正确" };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.warn("Topup with key failed:", err);
			return { success: false, message: msg };
		}
	}

	/**
	 * 易支付在线充值创建订单
	 */
	/**
	 * 从收银台页面提取二维码链接或图片 (使用 Node.js 原生 https 避免 Electron fetch 挂起)
	 */
	public async extractQrCode(payUrl: string): Promise<string | undefined> {
		try {
			log.info("Attempting to extract QR code from payUrl in background using https...");
			const page1 = await fetchPageHtml(payUrl);
			log.info(`Page 1 fetched, status: ${page1.status}, len: ${page1.html.length}`);

			const repMatch =
				page1.html.match(/window\.location\.replace\(['"]([^'"]+)['"]\)/i) ||
				page1.html.match(/window\.location\.href\s*=\s*['"]([^'"]+)['"]\)/i);
			let targetHtml = page1.html;
			let currentUrl = page1.url;
			if (repMatch?.[1]) {
				const nextUrl = new URL(repMatch[1], currentUrl).href;
				log.info(`Following JS redirect to: ${nextUrl}`);
				const page2 = await fetchPageHtml(nextUrl);
				log.info(`Page 2 fetched, status: ${page2.status}, len: ${page2.html.length}`);
				targetHtml = page2.html;
				currentUrl = page2.url;
			}

			// 1. 匹配 code_url 变量：如 var code_url = 'https://q.lakala.com/r/0000?...'
			const codeUrlMatch = targetHtml.match(/(?:var|let|const)?\s*code_url\s*=\s*['"]([^'"]+)['"]/i);
			if (codeUrlMatch?.[1]) {
				log.info(`Successfully extracted code_url from pay page: ${codeUrlMatch[1].slice(0, 50)}...`);
				return codeUrlMatch[1].trim();
			}

			// 2. 匹配 url_scheme 或 pay_url
			const schemeMatch = targetHtml.match(
				/(?:var|let|const)?\s*(?:url_scheme|pay_url|qrcode_url)\s*=\s*['"]([^'"]+)['"]/i,
			);
			if (schemeMatch?.[1] && !schemeMatch[1].startsWith("javascript:")) {
				log.info("Successfully extracted url_scheme from pay page");
				return schemeMatch[1].trim();
			}

			// 3. 匹配 base64 图片二维码
			const base64Match = targetHtml.match(/src=['"](data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+)['"]/i);
			if (base64Match?.[1]) {
				log.info("Successfully extracted base64 qr image from pay page");
				return base64Match[1].trim();
			}

			// 4. 匹配二维码 img 标签
			const imgMatch =
				targetHtml.match(/<img[^>]+id=['"]qrcode['"][^>]+src=['"]([^'"]+)['"]/i) ||
				targetHtml.match(/<img[^>]+src=['"]([^\x27"]*qrcode[^\x27"]*)['"]/i);
			if (imgMatch?.[1]) {
				log.info("Successfully extracted img qr url from pay page");
				return new URL(imgMatch[1], currentUrl).href;
			}
		} catch (err) {
			log.warn("Failed to extract qr code from pay url:", err);
		}
		return undefined;
	}

	/**
	 * 易支付在线充值创建订单
	 */
	public async createPayOrder(
		amount: number,
		paymentMethod: "alipay" | "wxpay",
	): Promise<{
		success: boolean;
		payUrl?: string;
		qrCode?: string;
		message?: string;
		errorCode?: "payment_unavailable";
	}> {
		if (amount < 1) {
			return { success: false, message: "充值金额不能少于 1 元" };
		}
		if (!this.currentSession.isLoggedIn) {
			return { success: false, message: "请先登录 567 API 账户后再进行充值" };
		}
		try {
			log.info(`Creating pay order: amount=${amount}, method=${paymentMethod}`);
			const res = await this.requestWithAuth<{
				message?: string;
				url?: string;
				data?: Record<string, string | number>;
			}>(`${this.baseServer}/api/user/pay`, {
				method: "POST",
				body: {
					amount: Math.floor(amount),
					payment_method: paymentMethod,
				},
			});

			if (res.data?.url && res.data?.data) {
				const params = new URLSearchParams();
				for (const [k, v] of Object.entries(res.data.data)) {
					params.set(k, String(v));
				}
				const payUrl = `${res.data.url}?${params.toString()}`;
				const qrCode = await this.extractQrCode(payUrl);
				return { success: true, payUrl, qrCode };
			}
			const message = res.data?.message || "创建支付订单失败，请稍后重试";
			return {
				success: false,
				message,
				...(isPaymentUnavailable(message) ? { errorCode: "payment_unavailable" as const } : {}),
			};
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.warn("Create pay order failed:", err);
			return {
				success: false,
				message: msg,
				...(isPaymentUnavailable(msg) ? { errorCode: "payment_unavailable" as const } : {}),
			};
		}
	}

	public getRawSession(): Api567Session {
		return { ...this.currentSession };
	}

	private loadSession(): void {
		this.preservedEncryptedSession = false;
		try {
			const path = getSessionFilePath();
			if (existsSync(path)) {
				const content = readFileSync(path, "utf8");
				const raw = JSON.parse(content);
				const encrypted = [raw.accessToken, raw.apiKey, raw.cookie].map(
					(value) => typeof value === "string" && value.startsWith("enc:"),
				);
				if (encrypted.some(Boolean) && !isSecureCredentialStorageAvailable()) {
					// Keep the on-disk session intact while the OS keyring is temporarily
					// unavailable. A later launch can decrypt it without forcing logout.
					this.currentSession = {
						...raw,
						isLoggedIn: false,
						accessToken: undefined,
						apiKey: undefined,
						cookie: undefined,
					};
					this.preservedEncryptedSession = true;
					log.warn("OS credential storage is unavailable; preserving the saved 567 API session");
					return;
				}
				const decrypted = {
					accessToken: decryptSecret(raw.accessToken),
					apiKey: decryptSecret(raw.apiKey),
					cookie: decryptSecret(raw.cookie),
				};
				const decryptionFailed =
					(encrypted[0] && !decrypted.accessToken) ||
					(encrypted[1] && !decrypted.apiKey) ||
					(encrypted[2] && !decrypted.cookie);
				if (decryptionFailed) {
					this.currentSession = {
						...raw,
						isLoggedIn: false,
						accessToken: undefined,
						apiKey: undefined,
						cookie: undefined,
					};
					this.preservedEncryptedSession = true;
					log.warn("Saved 567 API credentials could not be decrypted; preserving the session file for recovery");
					return;
				}
				this.currentSession = {
					...raw,
					...decrypted,
				};
				if (this.currentSession.isLoggedIn && !this.currentSession.accessToken) {
					void this.ensureValidAccessToken().catch((err) => {
						if (isExplicitAuthenticationFailure(err)) {
							this.accessTokenRefresh.reset();
							this.saveSession({ isLoggedIn: false });
							log.warn("The saved 567 API session was rejected; cleared its local session:", err);
							return;
						}
						// Network and service failures are not proof that credentials were
						// revoked. Keep the saved session so a later online request can retry.
						log.warn("Could not refresh the saved 567 API session; preserving it for retry:", err);
					});
				}
			}
		} catch (err) {
			log.warn("Failed to load 567api session:", err);
			this.currentSession = { isLoggedIn: false };
		}
	}

	private saveSession(session: Api567Session): void {
		this.currentSession = session;
		try {
			const path = getSessionFilePath();
			const toSave = {
				...session,
				accessToken: encryptSecret(session.accessToken),
				apiKey: encryptSecret(session.apiKey),
				cookie: encryptSecret(session.cookie),
			};
			const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
			mkdirSync(dirname(path), { recursive: true });
			try {
				writeFileSync(temporaryPath, JSON.stringify(toSave, null, 2), { encoding: "utf8", mode: 0o600 });
				renameSync(temporaryPath, path);
				this.preservedEncryptedSession = false;
			} catch (error) {
				rmSync(temporaryPath, { force: true });
				throw error;
			}
			void this.broadcastStatus();
		} catch (err) {
			log.error("Failed to save 567api session:", err);
		}
	}

	public async broadcastStatus(): Promise<void> {
		const status = await this.getStatus();
		try {
			for (const win of BrowserWindow.getAllWindows?.() ?? []) {
				if (!win.isDestroyed()) {
					win.webContents.send("vetta:567api:status-changed", status);
				}
			}
		} catch {
			// Electron BrowserWindow context not available in headless tests
		}
	}

	/**
	 * 与本地 models.json 对齐状态，确保当用户在模型设置里删除服务商/Key后，状态能够立即感知并重置
	 * 返回当前配置中真实生效的主力模型，避免界面仅凭模型顺序推断。
	 */
	public async reconcileWithModelConfig(): Promise<string | undefined> {
		if (!this.currentSession.isLoggedIn) return;
		try {
			const config = await getDesktopModelSettingsService().getConfig();
			const trustedOrigins = this.getTrustedOrigins();

			const validGroups: Api567GroupInfo[] = [];
			const enabledGroups: Api567GroupInfo[] = [];
			let totalModels = 0;
			let configChanged = false;

			for (const g of this.currentSession.groups ?? []) {
				const providerId = providerIdForGroupName(g.name);
				const provider = config.providers[providerId];
				if (
					provider?.apiKey &&
					Array.isArray(provider.models) &&
					isManaged567Provider(providerId, provider, trustedOrigins)
				) {
					const meta = this.currentSession.availableGroups?.[g.name];
					const expectedRatio = meta?.ratio !== undefined ? meta.ratio : (g.ratio ?? 1);
					const expectedDisplayName = g.name === "默认分组" ? "567 API" : `567 · ${g.name} (${expectedRatio}x)`;
					if (provider.displayName !== expectedDisplayName) {
						configChanged = true;
					}
					if (provider.headers) {
						for (const v of Object.values(provider.headers)) {
							if (typeof v === "string" && containsNonAscii(v)) configChanged = true;
						}
					}
					const modelIds = provider.models.map((m) => m.id);
					const groupInfo: Api567GroupInfo = {
						...g,
						ratio: expectedRatio,
						enabled: !provider.disabled,
						modelsCount: modelIds.length,
						models: modelIds,
					};
					validGroups.push(groupInfo);
					if (!provider.disabled) enabledGroups.push(groupInfo);
					totalModels += modelIds.length;
				}
			}
			for (const [pId, p] of Object.entries(config.providers || {})) {
				if (isManaged567Provider(pId, p, trustedOrigins) && p.headers) {
					for (const v of Object.values(p.headers)) {
						if (typeof v === "string" && containsNonAscii(v)) configChanged = true;
					}
				}
			}
			if (configChanged) {
				await this.mutateModelConfig((latest) => {
					let changed = false;
					for (const g of validGroups) {
						const pid = providerIdForGroupName(g.name);
						const provider = latest.providers[pid];
						if (!provider || !isManaged567Provider(pid, provider, trustedOrigins)) continue;
						const expectedDisplayName = g.name === "默认分组" ? "567 API" : `567 · ${g.name} (${g.ratio}x)`;
						if (provider.displayName !== expectedDisplayName) {
							provider.displayName = expectedDisplayName;
							changed = true;
						}
					}
					for (const [pId, p] of Object.entries(latest.providers || {})) {
						if (!isManaged567Provider(pId, p, trustedOrigins) || !p.headers) continue;
						for (const [k, v] of Object.entries(p.headers)) {
							if (typeof v === "string" && containsNonAscii(v)) {
								p.headers[k] = encodeURIComponent(v);
								changed = true;
							}
						}
					}
					return changed ? latest : null;
				});
			}

			this.currentSession.groups = validGroups;
			this.currentSession.modelsCount = totalModels;

			const selectionPool = enabledGroups;
			const slash = config.defaultModel?.indexOf("/") ?? -1;
			const defaultProviderId = slash > 0 ? config.defaultModel!.slice(0, slash) : undefined;
			const defaultModelId = slash > 0 ? config.defaultModel!.slice(slash + 1) : undefined;
			const matchedFromDefault = defaultProviderId
				? selectionPool.find((g) => providerIdForGroupName(g.name) === defaultProviderId)
				: undefined;
			if (matchedFromDefault && defaultModelId && matchedFromDefault.models?.includes(defaultModelId)) {
				this.currentSession.activeGroup = matchedFromDefault.name;
			} else if (
				this.currentSession.activeGroup &&
				selectionPool.some((g) => g.name === this.currentSession.activeGroup)
			) {
				// Preserve existing valid activeGroup even when defaultModel uses another provider or is cleared.
			} else {
				this.currentSession.activeGroup = undefined;
			}
			const activeProvider =
				this.currentSession.activeGroup && providerIdForGroupName(this.currentSession.activeGroup);
			const prefix = activeProvider ? `${activeProvider}/` : undefined;
			const activeProviderConfig = activeProvider ? config.providers[activeProvider] : undefined;
			const activeModelId =
				prefix && config.defaultModel?.startsWith(prefix) && !activeProviderConfig?.disabled
					? config.defaultModel.slice(prefix.length)
					: undefined;
			return activeModelId && activeProviderConfig?.models?.some((m) => m.id === activeModelId)
				? activeModelId
				: undefined;
		} catch (err) {
			log.warn("Failed to reconcile 567api with models.json:", err);
		}
	}

	/**
	 * 确保当前具备有效的 accessToken
	 */
	private async ensureValidAccessToken(): Promise<string> {
		if (this.currentSession.accessToken) {
			return this.currentSession.accessToken;
		}

		if (this.currentSession.cookie) {
			log.info("Refreshing access token via session refresh cookie...");
			return this.accessTokenRefresh.run(() => this.refreshAccountSession());
		}

		throw new Error("567 API 会话已过期，请重新登录");
	}

	private async refreshAccessTokenWithCookie(): Promise<string> {
		try {
			const refreshRes = await request<{
				success: boolean;
				message?: string;
				code?: number | string;
				data?: {
					access_token?: string;
					user?: { quota?: number; username?: string; display_name?: string };
				};
			}>(`${this.baseServer}/api/user/auth/refresh`, {
				method: "POST",
				headers: { Cookie: this.currentSession.cookie ?? "", Origin: new URL(this.baseServer).origin },
			});

			const rawCookies = refreshRes.headers["set-cookie"];
			let rotatedCookie = false;
			if (rawCookies && refreshRes.status >= 200 && refreshRes.status < 400) {
				const cookieHeader = (Array.isArray(rawCookies) ? rawCookies : [rawCookies])
					.map((cookie) => cookie.split(";")[0]?.trim() ?? "")
					.filter((cookie) => cookie && cookie.slice(cookie.indexOf("=") + 1).length > 0)
					.join("; ");
				if (cookieHeader) {
					this.currentSession.cookie = cookieHeader;
					rotatedCookie = true;
				}
			}

			if (refreshRes.data?.success && refreshRes.data.data?.access_token) {
				this.currentSession.accessToken = refreshRes.data.data.access_token;
				const userData = refreshRes.data.data.user;
				if (typeof userData?.quota === "number") {
					this.currentSession.quota = userData.quota;
					this.currentSession.quotaUsd = Number((userData.quota / QUOTA_PER_USD).toFixed(2));
				}
				if (userData?.display_name || userData?.username) {
					this.currentSession.username = userData.display_name || userData.username;
					this.currentSession.loginUsername = userData.username || this.currentSession.loginUsername;
				}
				this.saveSession(this.currentSession);
				return this.currentSession.accessToken;
			}

			if (rotatedCookie) this.saveSession(this.currentSession);
			const message = typeof refreshRes.data?.message === "string" ? refreshRes.data.message.slice(0, 200) : "";
			log.warn("567api access-token refresh rejected", {
				status: refreshRes.status,
				code: refreshRes.data?.code,
				message,
			});
			const code = Number(refreshRes.data?.code);
			if (isRefreshCookieRejected({ status: refreshRes.status, code, message })) {
				const status = refreshRes.status === 403 || code === 403 ? 403 : 401;
				throw new RefreshCookieRejectedError("567 API refresh cookie was rejected", status);
			}
		} catch (error) {
			if (error instanceof RefreshCookieRejectedError) throw error;
			log.warn("Failed to refresh access token:", error);
		}
		throw new Error("567 API 会话续期失败，请稍后重试");
	}

	private refreshAccountSession(): Promise<string> {
		return refreshWithAccountRecovery(
			() => this.refreshAccessTokenWithCookie(),
			() => {
				try {
					return loadAccountCredentials(getDesktopCredentialVault());
				} catch (error) {
					log.warn("Could not read saved 567 API account credentials:", error);
					return undefined;
				}
			},
			(credentials) => this.loginSilentlyWithPassword(credentials.username, credentials.password),
		);
	}

	private async loginSilentlyWithPassword(username: string, password: string): Promise<string> {
		const baseServer = this.baseServer;
		const body = preparePasswordLogin(
			username,
			password,
			await request(`${baseServer}/api/user/login/encryption-key`, { maxBytes: 32768, timeoutMs: 8000 }),
		);
		const loginRes = await request<{
			success: boolean;
			message?: string;
			data?: {
				access_token?: string;
				user?: { quota?: number; username?: string; display_name?: string };
				username?: string;
				display_name?: string;
				quota?: number;
			};
		}>(`${baseServer}/api/user/login`, { method: "POST", body });
		if (!loginRes.data?.success) {
			const message = loginRes.data?.message || "567 API 账户自动登录失败，请重新登录";
			if (loginRes.status < 500 && loginRes.status !== 429) throw new AccountLoginRejectedError(message);
			throw new Error(message);
		}
		const cookies = loginRes.headers["set-cookie"] || [];
		const cookie = (Array.isArray(cookies) ? cookies : [cookies])
			.map((value) => value.split(";")[0]?.trim() ?? "")
			.filter((value) => value && value.slice(value.indexOf("=") + 1).length > 0)
			.join("; ");
		const user = loginRes.data.data?.user || loginRes.data.data;
		this.currentSession = {
			...this.currentSession,
			isLoggedIn: true,
			authType: "account",
			username: user?.display_name || user?.username || username,
			loginUsername: user?.username || username,
			accessToken: loginRes.data.data?.access_token,
			cookie: cookie || this.currentSession.cookie,
			quota: user?.quota ?? this.currentSession.quota,
			quotaUsd:
				user?.quota === undefined ? this.currentSession.quotaUsd : Number((user.quota / QUOTA_PER_USD).toFixed(2)),
			lastUpdated: new Date().toISOString(),
		};
		this.saveSession(this.currentSession);
		if (!this.currentSession.accessToken) return this.refreshAccessTokenWithCookie();
		log.info("567 API account session restored after refresh-cookie rejection");
		return this.currentSession.accessToken;
	}

	/**
	 * 发送带鉴权的请求，遇到 401 自动刷新重试
	 */
	private async requestWithAuth<T = unknown>(
		urlStr: string,
		options: {
			method?: string;
			headers?: Record<string, string>;
			body?: unknown;
			timeoutMs?: number;
		} = {},
	): Promise<HttpResponse<T>> {
		let token = await this.ensureValidAccessToken();
		let res = await request<T>(urlStr, {
			...options,
			headers: {
				...options.headers,
				Authorization: `Bearer ${token}`,
			},
		});

		if (isAccountResponseRejected(res) && this.currentSession.cookie && this.currentSession.authType === "account") {
			log.warn("Access token expired (HTTP 401), refreshing token and retrying request...");
			try {
				token = await this.accessTokenRefresh.afterUnauthorized(
					token,
					() => this.currentSession.accessToken,
					() => {
						this.currentSession.accessToken = undefined;
					},
					() => this.refreshAccountSession(),
				);
				res = await request<T>(urlStr, {
					...options,
					headers: {
						...options.headers,
						Authorization: `Bearer ${token}`,
					},
				});
			} catch (refreshErr) {
				log.warn("Failed to refresh token after 401:", refreshErr);
				if (isExplicitAuthenticationFailure(refreshErr) && this.currentSession.isLoggedIn) {
					log.warn("The 567 API explicitly rejected the active session; clearing the local login");
					await this.logout();
				}
			}
		}

		if (res.status === 429) {
			log.warn("Rate limited (HTTP 429) from 567 API, cooling down for 2 minutes.");
			this.rateLimitedUntil = Date.now() + 2 * 60 * 1000;
		}
		return res;
	}

	/**
	 * 获取 567 API 所有的可用分组信息（带 10 分钟本地缓存）
	 */
	public async getAvailableGroups(forceRefresh = false): Promise<Record<string, { desc: string; ratio: number }>> {
		if (!forceRefresh && this.currentSession.availableGroups !== undefined && this.currentSession.groupsUpdated) {
			const age = Date.now() - new Date(this.currentSession.groupsUpdated).getTime();
			if (Number.isFinite(age) && age >= 0 && age < AVAILABLE_GROUPS_CACHE_TTL_MS) {
				return this.currentSession.availableGroups;
			}
		}

		const gen = this.accountGeneration;
		if (this.availableGroupsInFlight?.gen === gen) {
			return this.availableGroupsInFlight.promise;
		}

		const promise = (async (): Promise<Record<string, { desc: string; ratio: number }>> => {
			try {
				const res = await this.requestWithAuth<{
					success: boolean;
					message?: string;
					data?: Record<string, { desc?: string; ratio?: number }> | null;
				}>(`${this.baseServer}/api/user/groups`);

				if (
					res.status !== 200 ||
					res.data?.success !== true ||
					!res.data.data ||
					typeof res.data.data !== "object" ||
					Array.isArray(res.data.data)
				) {
					throw new Error(res.data?.message || `获取可用分组失败 (HTTP ${res.status})`);
				}

				const result: Record<string, { desc: string; ratio: number }> = Object.create(null);
				for (const [k, v] of Object.entries(res.data.data)) {
					if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid group metadata");
					result[k] = {
						desc: v?.desc ?? "",
						ratio: typeof v?.ratio === "number" ? v.ratio : 1,
					};
				}
				if (this.accountGeneration !== gen) return result;
				this.groupsFetchFailed = false;
				this.currentSession.availableGroups = result;
				this.currentSession.groupsUpdated = new Date().toISOString();
				this.saveSession(this.currentSession);
				return result;
			} catch (err) {
				log.warn("Failed to fetch user groups:", err);
				if (this.accountGeneration === gen) {
					this.groupsFetchFailed = true;
					void this.broadcastStatus();
				}
				throw err;
			}
		})().finally(() => {
			if (this.availableGroupsInFlight?.promise === promise) {
				this.availableGroupsInFlight = null;
			}
		});

		this.availableGroupsInFlight = { gen, force: forceRefresh, promise };
		return promise;
	}

	/**
	 * 使用 567 API 账户系统访问令牌 (PAT) 登录
	 */
	public async loginWithAccessToken(accessToken: string): Promise<{ success: boolean; message?: string }> {
		try {
			const token = accessToken.trim();
			if (!token) {
				return { success: false, message: "账户令牌不能为空" };
			}

			log.info("Verifying 567api system access token...");
			const selfRes = await request<{
				success: boolean;
				message?: string;
				data?: {
					id: number;
					username: string;
					display_name?: string;
					quota?: number;
					role?: number;
					user?: {
						id: number;
						username: string;
						display_name?: string;
						quota?: number;
						role?: number;
					};
				};
			}>(`${this.baseServer}/api/user/self`, {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!selfRes.data || !selfRes.data.success || !selfRes.data.data) {
				return {
					success: false,
					message: selfRes.data?.message || `账户访问令牌验证失败 (HTTP ${selfRes.status})`,
				};
			}
			try {
				removeAccountCredentials(getDesktopCredentialVault());
			} catch (error) {
				log.warn("Could not remove saved 567 API account credentials:", error);
			}

			const rawData = selfRes.data.data;
			const userData = rawData.user || rawData;
			const quota = userData.quota ?? 0;
			const quotaUsd = Number((quota / QUOTA_PER_USD).toFixed(2));
			const displayName = userData.display_name || userData.username || "567 用户";

			const prevSession = this.currentSession;
			const prevIdentity = getAccountIdentityKey(prevSession);
			const nextIdentity = getAccountIdentityKey({
				isLoggedIn: true,
				authType: "access_token",
				loginUsername: userData?.username,
				username: displayName,
			});
			const switchedAccount = Boolean(
				prevSession.isLoggedIn && prevIdentity && nextIdentity && prevIdentity !== nextIdentity,
			);
			this.resetAccountRuntimeState();
			if (switchedAccount) {
				await this.clearManagedProvidersFromConfig();
			}

			this.currentSession = {
				isLoggedIn: true,
				authType: "access_token",
				username: displayName,
				loginUsername: userData?.username,
				accessToken: token,
				quota,
				quotaUsd,
				lastUpdated: new Date().toISOString(),
				...(!switchedAccount && prevSession.isLoggedIn
					? {
							activeGroup: prevSession.activeGroup,
							imageGroup: prevSession.imageGroup,
							imageModel: prevSession.imageModel,
							groups: prevSession.groups,
							availableGroups: prevSession.availableGroups,
							groupsUpdated: prevSession.groupsUpdated,
						}
					: {}),
			};
			this.accessTokenRefresh.reset();
			// 登录时只刷新目录与已接入分组，不替用户选择或创建分组令牌
			try {
				await this.refreshGroupsAndModelsInBackground({ startup: true });
			} catch (syncErr) {
				log.warn("Refresh group catalog failed on token login:", syncErr);
			}
			await this.reconcileWithModelConfig();
			this.startupBackgroundRefreshedGen = this.accountGeneration;

			this.saveSession(this.currentSession);
			log.info(`567api access token login success for: ${displayName}, quota: ${quotaUsd}`);
			return { success: true };
		} catch (err) {
			log.error("567api access token login error:", err);
			return { success: false, message: err instanceof Error ? err.message : String(err) };
		}
	}

	/**
	 * 使用 567 API 账户密码登录
	 */
	public async loginWithPassword(username: string, password: string): Promise<{ success: boolean; message?: string }> {
		try {
			if (!username.trim() || !password.trim()) {
				return { success: false, message: "用户名和密码不能为空" };
			}

			log.info(`Attempting password login for: ${username}`);
			const baseServer = this.baseServer;
			const body = preparePasswordLogin(
				username.trim(),
				password.trim(),
				await request(`${baseServer}/api/user/login/encryption-key`, { maxBytes: 32768, timeoutMs: 8000 }),
			);
			const loginRes = await request<{
				success: boolean;
				message?: string;
				data?: {
					access_token?: string;
					user?: {
						id: number;
						username: string;
						display_name?: string;
						quota?: number;
						role?: number;
					};
					id?: number;
					username?: string;
					display_name?: string;
					quota?: number;
					role?: number;
				};
			}>(`${baseServer}/api/user/login`, {
				method: "POST",
				body,
			});

			if (!loginRes.data || !loginRes.data.success) {
				return { success: false, message: loginRes.data?.message || "用户名或密码错误" };
			}

			const rawCookies = loginRes.headers["set-cookie"] || [];
			const cookieHeader = (Array.isArray(rawCookies) ? rawCookies : [rawCookies])
				.map((c) => c.split(";")[0])
				.join("; ");

			const resData = loginRes.data.data;
			const accessToken = resData?.access_token;
			const userData = resData?.user || resData;
			const quota = userData?.quota ?? 0;
			const quotaUsd = Number((quota / QUOTA_PER_USD).toFixed(2));
			const displayName = userData?.display_name || userData?.username || username;

			const prevSession = this.currentSession;
			const prevIdentity = getAccountIdentityKey(prevSession);
			const nextIdentity = getAccountIdentityKey({
				isLoggedIn: true,
				authType: "account",
				loginUsername: userData?.username,
				username: displayName,
			});
			const switchedAccount = Boolean(
				prevSession.isLoggedIn && prevIdentity && nextIdentity && prevIdentity !== nextIdentity,
			);
			this.resetAccountRuntimeState();
			if (switchedAccount) {
				await this.clearManagedProvidersFromConfig();
			}

			this.currentSession = {
				isLoggedIn: true,
				authType: "account",
				username: displayName,
				loginUsername: userData?.username,
				accessToken,
				cookie: cookieHeader,
				quota,
				quotaUsd,
				lastUpdated: new Date().toISOString(),
				...(!switchedAccount && prevSession.isLoggedIn
					? {
							activeGroup: prevSession.activeGroup,
							imageGroup: prevSession.imageGroup,
							imageModel: prevSession.imageModel,
							groups: prevSession.groups,
							availableGroups: prevSession.availableGroups,
							groupsUpdated: prevSession.groupsUpdated,
						}
					: {}),
			};
			this.accessTokenRefresh.reset();
			try {
				if (
					!saveAccountCredentials(getDesktopCredentialVault(), {
						username: username.trim(),
						password: password.trim(),
					})
				) {
					log.warn("Secure storage unavailable; 567 API password re-login will require manual login");
				}
			} catch (error) {
				log.warn("Could not securely save 567 API account credentials:", error);
			}

			// 登录时只刷新目录与已接入分组，不替用户选择或创建分组令牌
			try {
				await this.refreshGroupsAndModelsInBackground({ startup: true });
			} catch (syncErr) {
				log.warn("Refresh group catalog failed on password login:", syncErr);
			}
			await this.reconcileWithModelConfig();
			this.startupBackgroundRefreshedGen = this.accountGeneration;

			this.saveSession(this.currentSession);
			log.info(`567api password login success for: ${username}, quota: ${quotaUsd}`);
			return { success: true };
		} catch (err) {
			log.error("567api password login error:", err);
			return {
				success: false,
				message:
					err instanceof PasswordLoginEncryptionError
						? mainT("api567.loginEncryptionFailed")
						: err instanceof Error
							? err.message
							: String(err),
			};
		}
	}

	/**
	 * 获取指定 Token 的完整未脱敏 Key
	 */
	private async fetchFullKey(tokenId: number): Promise<string | undefined> {
		try {
			const keyRes = await this.requestWithAuth<{
				success: boolean;
				data?: { key?: string } | string;
			}>(`${this.baseServer}/api/token/${tokenId}/key`, {
				method: "POST",
				body: {},
			});

			if (keyRes.data?.success && keyRes.data.data) {
				const rawKey = typeof keyRes.data.data === "string" ? keyRes.data.data : keyRes.data.data.key;
				if (rawKey && !rawKey.includes("*")) {
					const clean = rawKey.trim();
					return clean.startsWith("sk-") ? clean : `sk-${clean}`;
				}
			}
		} catch (err) {
			log.warn(`Failed to fetch full key for token ${tokenId}:`, err);
		}
		return undefined;
	}

	/**
	 * 单独接入某个分组：获取或创建专属 Key、拉取该分组模型、注册 Provider
	 */
	public async syncSingleGroup(
		groupName: string,
		groupMeta?: { desc?: string; ratio?: number },
	): Promise<{ success: boolean; groupInfo?: Api567GroupInfo; message?: string }> {
		const gen = this.accountGeneration;
		try {
			const rawGroupName = groupName === "默认分组" ? "" : groupName;
			const displayGroupName = rawGroupName || "默认分组";
			log.info(`Ensuring API key for group: "${displayGroupName}"`);
			const apiKey = await this.resolveOrCreateApiKeyForGroup(rawGroupName);
			if (this.accountGeneration !== gen) return { success: false, message: "账户状态已变更" };

			log.info(`Fetching models for group: "${displayGroupName}"`);
			const { modelDefs, imageModelIds } = await this.fetchGroupModelsWithImages(rawGroupName, apiKey);
			if (this.accountGeneration !== gen) return { success: false, message: "账户状态已变更" };

			const providerId = providerIdForGroupName(rawGroupName);
			const meta = groupMeta ?? this.currentSession.availableGroups?.[displayGroupName];
			const ratio =
				meta?.ratio !== undefined
					? meta.ratio
					: (this.currentSession.availableGroups?.[displayGroupName]?.ratio ?? 1);
			const desc = meta?.desc ?? this.currentSession.availableGroups?.[displayGroupName]?.desc ?? "";
			const displayName = rawGroupName ? `567 · ${rawGroupName} (${ratio}x)` : "567 API";

			let finalModelDefs = modelDefs;
			await this.mutateModelConfig((config) => {
				if (this.accountGeneration !== gen) return null;
				const existingProvider = config.providers[providerId];
				finalModelDefs = mergeGroupModelsPreservingManualEdits(modelDefs, existingProvider?.models);

				config.providers[providerId] = {
					...(existingProvider?.disabled === undefined ? {} : { disabled: existingProvider.disabled }),
					...(existingProvider?.authHeader === undefined ? {} : { authHeader: existingProvider.authHeader }),
					modelOverrides: existingProvider?.modelOverrides,
					baseUrl: this.baseV1,
					apiKey,
					displayName,
					api: existingProvider?.api ?? DEFAULT_CHAT_INFERENCE_API,
					managedChatProtocolVersion: 1,
					icon: getProviderIconForGroup(displayGroupName),
					headers: { "X-567-Group": encodeURIComponent(rawGroupName || "default") },
					modelsSyncedAt: new Date().toISOString(),
					models: finalModelDefs,
				};

				const prefix = `${providerId}/`;
				const previousModel = config.defaultModel?.startsWith(prefix)
					? config.defaultModel.slice(prefix.length)
					: undefined;
				if (previousModel !== undefined && !finalModelDefs.some((model) => model.id === previousModel)) {
					const best = pickBestModel(finalModelDefs);
					if (best) {
						config.defaultModel = `${providerId}/${best.id}`;
					} else {
						delete config.defaultModel;
					}
				}
				return config;
			});
			if (this.accountGeneration !== gen) return { success: false, message: "账户状态已变更" };

			const modelIds = finalModelDefs.map((m) => m.id);
			const groupInfo: Api567GroupInfo = {
				name: displayGroupName,
				desc,
				ratio,
				enabled: true,
				modelsCount: modelIds.length,
				models: modelIds,
				imageModels: imageModelIds,
			};

			const existingGroups = (this.currentSession.groups ?? []).filter((g) => g.name !== displayGroupName);
			existingGroups.push(groupInfo);
			this.currentSession.groups = existingGroups;

			if (!this.currentSession.apiKey) {
				this.currentSession.apiKey = apiKey;
			}
			this.currentSession.modelsCount = existingGroups.reduce((sum, g) => sum + (g.modelsCount ?? 0), 0);
			this.confirmedModelProviderIds.add(providerId);
			this.failedModelProviderIds.delete(providerId);
			this.removedModelProviderIds.delete(providerId);

			this.saveSession(this.currentSession);
			return { success: true, groupInfo };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			log.error(`Error syncing group ${groupName}:`, err);
			return { success: false, message: msg };
		}
	}

	/**
	 * 移除某个分组的接入：不仅从本地 models.json 卸载，同时自动从中转站删除对应的 567 Agent 令牌！
	 */
	public async removeGroup(groupName: string): Promise<{ success: boolean; message?: string }> {
		try {
			const rawGroupName = groupName === "默认分组" ? "" : groupName;
			const displayGroupName = rawGroupName || "默认分组";
			const providerId = providerIdForGroupName(rawGroupName);
			const trustedOrigins = this.getTrustedOrigins();

			// 1. 从本地 models.json 移除
			await this.mutateModelConfig((config) => {
				if (
					config.providers[providerId] &&
					isManaged567Provider(providerId, config.providers[providerId], trustedOrigins)
				) {
					delete config.providers[providerId];
					if (config.defaultModel?.startsWith(`${providerId}/`)) {
						delete config.defaultModel;
					}
					return config;
				}
				return null;
			});

			// 2. 查找并从中转站服务器删除由 567 Agent 创建的专属令牌，释放 10 个 Token 的配额！
			try {
				const targetName = rawGroupName ? `567 Agent [${rawGroupName}]` : "567 Agent";
				const listRes = await this.requestWithAuth<unknown>(`${this.baseServer}/api/token/?p=0&size=100`);
				const tokens = extractTokens(listRes.data);
				const matched = tokens.find(
					(t) =>
						t.name === targetName || (rawGroupName && t.group === rawGroupName && t.name.startsWith("567 Agent")),
				);
				if (matched) {
					log.info(`Deleting remote token id=${matched.id} ("${matched.name}") from NewAPI server...`);
					await this.requestWithAuth(`${this.baseServer}/api/token/${matched.id}`, {
						method: "DELETE",
					});
					log.info(`Remote token id=${matched.id} deleted successfully`);
				}
			} catch (delErr) {
				log.warn(`Failed to delete remote token for group ${groupName}:`, delErr);
			}

			// 3. 更新会话状态
			this.currentSession.groups = (this.currentSession.groups ?? []).filter(
				(g) => g.name !== groupName && g.name !== displayGroupName,
			);
			if (this.currentSession.activeGroup === groupName || this.currentSession.activeGroup === displayGroupName) {
				this.currentSession.activeGroup = undefined;
			}
			if (this.currentSession.imageGroup === displayGroupName) {
				this.currentSession.imageGroup = undefined;
				this.currentSession.imageModel = undefined;
			}
			this.currentSession.modelsCount = this.currentSession.groups.reduce((sum, g) => sum + (g.modelsCount ?? 0), 0);
			this.confirmedModelProviderIds.delete(providerId);
			this.failedModelProviderIds.delete(providerId);
			this.removedModelProviderIds.delete(providerId);

			this.saveSession(this.currentSession);
			return { success: true };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return { success: false, message: msg };
		}
	}

	/**
	 * 设置主力分组及可选模型。仅切组时允许补接入；明确选模型时必须匹配现有模型，避免失败操作改变默认配置。
	 */
	public async setActiveGroup(groupName: string, modelName?: string): Promise<{ success: boolean; message?: string }> {
		const generation = this.accountGeneration;
		if (
			!this.currentSession.isLoggedIn ||
			(this.hasConfirmedAvailableGroups() && !isGroupAvailable(this.currentSession.availableGroups ?? {}, groupName))
		)
			return { success: false, message: mainT("api567Model.groupUnavailable") };
		const providerId = providerIdForGroupName(groupName);
		try {
			const service = getDesktopModelSettingsService();
			const initialConfig = await service.getConfig();
			if (generation !== this.accountGeneration)
				return { success: false, message: mainT("api567Model.groupUnavailable") };
			const provider = initialConfig.providers[providerId];

			// 若本地未配置该 provider 或无有效密钥/模型，先执行自动接入创建 Key 与模型
			if (!provider || !provider.apiKey || !provider.models || provider.models.length === 0) {
				if (modelName !== undefined) return { success: false, message: mainT("api567Model.unavailable") };
				log.info(`Provider ${providerId} not found in models.json, re-syncing group "${groupName}"...`);
				const syncRes = await this.syncSingleGroup(groupName);
				if (!syncRes.success) {
					return { success: false, message: syncRes.message || `未能为分组 [${groupName}] 创建 Key 与接入模型` };
				}
			}

			let selectedFound = false;
			await this.mutateModelConfig((config) => {
				if (generation !== this.accountGeneration) return null;
				const latestProvider = config.providers[providerId];
				if (!latestProvider || latestProvider.disabled) return null;
				const selected = modelName
					? latestProvider.models?.find(
							(model) => model.id === modelName && modelOutputKind(model.id, model) !== "image-only",
						)
					: pickBestModel(latestProvider?.models ?? []);
				if (!selected) return null;
				selectedFound = true;
				config.defaultModel = `${providerId}/${selected.id}`;
				return config;
			});
			if (!selectedFound || generation !== this.accountGeneration) {
				return { success: false, message: mainT("api567Model.unavailable") };
			}

			this.currentSession.activeGroup = groupName;
			this.saveSession(this.currentSession);
			return { success: true };
		} catch (err) {
			return { success: false, message: err instanceof Error ? err.message : String(err) };
		}
	}

	/**
	 * 获取指定分组所支持的模型列表
	 */
	private async fetchGroupModelsWithImages(
		groupName: string,
		apiKey: string,
	): Promise<{ modelDefs: ModelDefinition[]; imageModelIds: string[] }> {
		const result = await this.fetchGroupModelsResult(groupName, apiKey);
		if (!result.ok) {
			throw new Error(result.error);
		}
		return { modelDefs: result.modelDefs, imageModelIds: result.imageModelIds };
	}

	private async fetchGroupModelsResult(
		groupName: string,
		apiKey: string,
	): Promise<{ ok: true; modelDefs: ModelDefinition[]; imageModelIds: string[] } | { ok: false; error: string }> {
		let models: ModelDefinition[] = [];
		let userModelsSucceeded = false;
		let v1ModelsSucceeded = false;
		let lastError = "Failed to fetch group models";

		if (groupName) {
			try {
				const res = await this.requestWithAuth<{ success: boolean; data?: unknown }>(
					`${this.baseServer}/api/user/models?group=${encodeURIComponent(groupName)}`,
				);
				if (res.status === 200 && res.data?.success === true && Array.isArray(res.data.data)) {
					const parsed = parseModelList(res.data.data);
					if (parsed.length !== res.data.data.length) throw new Error("Invalid group model list");
					models = parsed;
					userModelsSucceeded = true;
				} else {
					lastError = `Group models endpoint returned HTTP ${res.status}`;
				}
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
				log.warn("Could not fetch group model metadata", error);
			}
		}
		if (!userModelsSucceeded || models.some((model) => model.contextWindow === undefined)) {
			try {
				const res = await request<{ data?: unknown }>(`${this.baseV1}/models`, {
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"X-567-Group": encodeURIComponent(groupName || "default"),
					},
				});
				if (res.status === 200 && res.data && typeof res.data === "object" && Array.isArray(res.data.data)) {
					const listed = parseModelList(res.data.data);
					if (listed.length !== res.data.data.length) throw new Error("Invalid compatible model list");
					v1ModelsSucceeded = true;
					if (models.length === 0) models = listed;
					else {
						const metadata = new Map(listed.map((model) => [model.id, model]));
						models = models.map((model) => ({
							...model,
							...(model.contextWindow === undefined ? metadata.get(model.id) : undefined),
							output: model.output ?? metadata.get(model.id)?.output,
						}));
					}
				} else {
					lastError = `Models endpoint returned HTTP ${res.status}`;
				}
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
				log.warn("Could not fetch compatible model metadata", error);
			}
		}
		if (!userModelsSucceeded && !v1ModelsSucceeded) {
			return { ok: false, error: lastError };
		}
		const desc = this.currentSession.availableGroups?.[groupName]?.desc || "";
		const isDrawingGroup = isImageOnlyGroup(groupName, desc);
		const imageModelIds: string[] = [];
		const chatModels = models.filter((model) => {
			const kind = modelOutputKind(model.id, model);
			const drawingOnly = kind === "image-only" || (isDrawingGroup && kind === "unknown");
			if (drawingOnly || kind === "text-and-image") imageModelIds.push(model.id);
			return !drawingOnly && (kind === "text-and-image" || !NON_CHAT.test(model.id));
		});
		const catalog = await listPresetProviders();
		return {
			ok: true,
			modelDefs: enrichModelContexts(
				chatModels,
				catalog.providers.flatMap((provider) => provider.catalogModels),
			),
			imageModelIds,
		};
	}

	/**
	 * 对外暴露获取或创建专属 API Key (sk-...)
	 */
	public async getApiKey(groupName?: string): Promise<string> {
		return this.resolveOrCreateApiKeyForGroup(groupName === "默认分组" ? "" : groupName);
	}

	/**
	 * 使用指定分组解析或创建专属 API Key (sk-...)
	 */
	private async resolveOrCreateApiKeyForGroup(groupName?: string): Promise<string> {
		const targetName = groupName ? `567 Agent [${groupName}]` : "567 Agent";
		const targetGroup = groupName || "default";
		const matchesGroup = (token: RawNewApiToken) => token.status === 1 && (token.group || "default") === targetGroup;
		const readTokens = async () => {
			const response = await this.requestWithAuth<unknown>(`${this.baseServer}/api/token/?p=0&size=100`);
			if (
				response.status !== 200 ||
				(response.data &&
					typeof response.data === "object" &&
					"success" in response.data &&
					response.data.success !== true)
			) {
				throw new Error(mainT("api567Credentials.listFailed"));
			}
			return extractTokens(response.data);
		};
		const readKey = async (token: RawNewApiToken) => {
			if (token.key && !token.key.includes("*") && token.key.trim().length >= 20) {
				const key = token.key.trim();
				return key.startsWith("sk-") ? key : `sk-${key}`;
			}
			const key = await this.fetchFullKey(token.id);
			if (!key) throw new Error(mainT("api567Credentials.unmaskFailed"));
			return key;
		};

		const existing = await readTokens();
		const matched =
			existing.find((token) => matchesGroup(token) && token.name === targetName) ??
			(groupName ? existing.find(matchesGroup) : undefined);
		if (matched) return readKey(matched);
		// A full account is not permission to rename or repurpose a different group's key.
		if (existing.length >= 10) throw new Error(mainT("api567Credentials.limitReached"));

		const created = await this.requestWithAuth<{ success?: boolean; message?: string }>(
			`${this.baseServer}/api/token/`,
			{
				method: "POST",
				body: {
					name: targetName,
					group: groupName || undefined,
					remain_quota: 0,
					expired_time: -1,
					unlimited_quota: true,
				},
			},
		);
		if (created.status !== 200 || !created.data?.success) {
			throw new Error(created.data?.message || mainT("api567Credentials.createFailed"));
		}
		const reloaded = await readTokens();
		const own = reloaded.find((token) => matchesGroup(token) && token.name === targetName);
		if (!own) throw new Error(mainT("api567Credentials.createFailed"));
		return readKey(own);
	}

	public async getUsageGroupNames(): Promise<Map<string, string | undefined>> {
		const generation = this.accountGeneration;
		const { providers } = await getDesktopModelSettingsService().getConfig();
		const result = new Map<string, string | undefined>();
		if (generation !== this.accountGeneration) return result;
		const origins = this.getTrustedOrigins();
		for (const name of new Set([
			...(this.currentSession.groups ?? []).map((group) => group.name),
			...Object.keys(this.currentSession.availableGroups ?? {}),
		])) {
			const id = providerIdForGroupName(name);
			if (!isManaged567Provider(id, providers[id], origins)) continue;
			const label = name || "默认分组";
			result.set(id, result.has(id) && result.get(id) !== label ? undefined : label);
		}
		return result;
	}

	public async readBilledUsage(): Promise<Api567BilledSnapshot> {
		if (!this.currentSession.isLoggedIn) return { status: "signed-out" };
		const reader = this.billedUsage;
		const server = this.baseServer;
		const bill = await reader.read(
			async (from, to) => {
				const token = await this.ensureValidAccessToken();
				if (reader !== this.billedUsage || server !== this.baseServer) throw new Error("Account changed");
				const query = new URLSearchParams({ type: "2", start_timestamp: String(from), end_timestamp: String(to) });
				return request<{ success?: boolean; data?: { quota?: number } }>(`${server}/api/log/self/stat?${query}`, {
					headers: { Authorization: `Bearer ${token}` },
					signal: AbortSignal.timeout(8_000),
					maxBytes: 32 * 1024,
				});
			},
			Math.max(this.rateLimitedUntil, this.billingRate?.limitedUntil ?? 0),
		);
		if (reader !== this.billedUsage || server !== this.baseServer) return { status: "unavailable" };
		if (bill.quota == null) return bill;
		if (
			bill.status === "ready" &&
			this.rateLimitedUntil <= Date.now() &&
			(!this.billingRate || this.billingRate.until <= Date.now())
		) {
			const rate: NonNullable<typeof this.billingRate> = { until: Date.now() + 5 * 60_000 };
			this.billingRate = rate;
			rate.pending = request<{ success?: boolean; data?: { quota_per_unit?: unknown } }>(`${server}/api/status`, {
				signal: AbortSignal.timeout(5000),
				maxBytes: 128 * 1024,
			})
				.then((response) => {
					if (response.status === 429 || response.headers["retry-after"]) {
						rate.until = Math.max(rate.until, retryAfter(response.headers["retry-after"], Date.now()));
						if (response.status === 429) rate.limitedUntil = rate.until;
					}
					const value = response.data?.data?.quota_per_unit;
					if (
						response.status === 200 &&
						response.data?.success === true &&
						typeof value === "number" &&
						Number.isFinite(value) &&
						value > 0
					) {
						rate.until = Date.now() + 24 * 60 * 60_000;
						return value;
					}
					return undefined;
				})
				.catch(() => undefined);
		}
		const perUsd = await this.billingRate?.pending;
		if (reader !== this.billedUsage || server !== this.baseServer) return { status: "unavailable" };
		return {
			...bill,
			retryAt: Math.max(bill.retryAt ?? 0, this.billingRate?.limitedUntil ?? 0),
			usd: perUsd ? bill.quota / perUsd : undefined,
		};
	}

	public async refreshQuota(force = false): Promise<{ success: boolean; quota?: number; quotaUsd?: number }> {
		if (!this.currentSession.isLoggedIn) {
			return { success: false };
		}

		if (this.refreshQuotaPromise) {
			return this.refreshQuotaPromise;
		}

		if (Date.now() < this.rateLimitedUntil) {
			return this.currentSession.quota === undefined
				? { success: false }
				: { success: true, quota: this.currentSession.quota, quotaUsd: this.currentSession.quotaUsd };
		}
		if (!force) {
			if (this.currentSession.quota !== undefined && this.currentSession.lastUpdated) {
				const age = Date.now() - new Date(this.currentSession.lastUpdated).getTime();
				if (age < 3 * 60 * 1000) {
					return {
						success: true,
						quota: this.currentSession.quota,
						quotaUsd: this.currentSession.quotaUsd,
					};
				}
			}
		}

		const execute = async (): Promise<{ success: boolean; quota?: number; quotaUsd?: number }> => {
			try {
				const res = await this.requestWithAuth<{
					success: boolean;
					data?: {
						quota?: number;
						username?: string;
						user?: { quota?: number; username?: string };
					};
				}>(`${this.baseServer}/api/user/self`);

				if (res.data?.success && res.data.data) {
					const userData = res.data.data.user || res.data.data;
					if (typeof userData.quota === "number") {
						const quota = userData.quota;
						const quotaUsd = Number((quota / QUOTA_PER_USD).toFixed(2));
						this.saveSession({
							...this.currentSession,
							loginUsername: userData.username || this.currentSession.loginUsername,
							quota,
							quotaUsd,
							lastUpdated: new Date().toISOString(),
						});
						return { success: true, quota, quotaUsd };
					}
				}
			} catch (err) {
				log.warn("Failed to refresh 567api quota:", err);
			}
			return { success: false };
		};

		this.refreshQuotaPromise = execute().finally(() => {
			this.refreshQuotaPromise = null;
		});

		return this.refreshQuotaPromise;
	}

	/**
	 * 退出登录
	 */
	public async logout(): Promise<void> {
		this.resetAccountRuntimeState();
		this.accessTokenRefresh.reset();
		try {
			removeAccountCredentials(getDesktopCredentialVault());
		} catch (error) {
			log.warn("Could not remove saved 567 API account credentials:", error);
		}
		this.saveSession({ isLoggedIn: false });

		try {
			await this.clearManagedProvidersFromConfig();
		} catch (err) {
			log.warn("Failed to clear 567api providers from models.json:", err);
		}

		log.info("567api logged out");
	}
}
