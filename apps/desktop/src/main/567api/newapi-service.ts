import { isPaymentUnavailable } from "../../shared/api567/payment-failure.js";
import { isAccountResponseRejected } from "./access-token-refresh.js";

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
	const sorted = [...models].sort((a, b) => getModelScore(b.id) - getModelScore(a.id));
	return sorted[0];
}

import { createHash } from "node:crypto";
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
import type { ModelDefinition } from "../models/model-settings-service.js";
import { listPresetProviders } from "../models/presets/sync.js";
import {
	AccessTokenRefreshCoordinator,
	AccountLoginRejectedError,
	isRefreshCookieRejected,
	RefreshCookieRejectedError,
	refreshWithAccountRecovery,
} from "./access-token-refresh.js";
import { loadAccountCredentials, removeAccountCredentials, saveAccountCredentials } from "./account-credentials.js";
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

export function getProviderIdForGroup(groupName: string): string {
	const map: Record<string, string> = {
		"chat GPT 满血": "567api_gpt_full",
		"chat GPT pro": "567api_gpt_pro",
		"chat GPT 特价": "567api_gpt_sale",
		"chat GPT 备用": "567api_gpt_backup",
		"chat GPT 备用2": "567api_gpt_backup2",
		"Anthropic Claude_max": "567api_claude_max",
		"Anthropic Claude_kiro": "567api_claude_kiro",
		"Google Gemini": "567api_gemini",
		反重力Gemini: "567api_gemini_sale",
		deepseek官: "567api_deepseek",
		"xAI grok": "567api_grok",
		国模特价组1: "567api_domestic_1",
		国模特价组2: "567api_domestic_2",
		"国🥚": "567api_guodan",
		福利特价: "567api_welfare_sale",
		画图: "567api_image",
		画图模型: "567api_image_model",
	};
	if (map[groupName]) return map[groupName];
	const asciiSlug = groupName
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "")
		.slice(0, 16);
	if (asciiSlug.length >= 3) return `567api_${asciiSlug}`;
	const hash = createHash("md5").update(groupName).digest("hex").slice(0, 8);
	return `567api_${hash}`;
}

export function getProviderIconForGroup(groupName: string): string {
	const lower = groupName.toLowerCase();
	if (lower.includes("claude")) return "claude";
	if (lower.includes("gemini")) return "gemini";
	if (lower.includes("deepseek")) return "deepseek";
	if (lower.includes("grok")) return "grok";
	if (lower.includes("gpt") || lower.includes("chat")) return "openai";
	if (lower.includes("国模") || lower.includes("qwen")) return "qwen";
	return "openai";
}

const NON_CHAT =
	/embedding|embed|whisper|tts|audio|realtime|-live-|moderation|dall-e|image|transcribe|rerank|vision-ocr|veo-|lyria|imagen|deep-research|computer-use|-character|livetranslate/i;

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

	public async getStatus(): Promise<Api567Status> {
		const routes = getApi567RouteStore();
		if (!routes.selectedRoute) return { isLoggedIn: false, serviceRouteError: true, serviceRoutes: routes.catalog };
		const activeModel = await this.reconcileWithModelConfig();
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
			modelsCount: this.currentSession.modelsCount,
		};
	}

	public getImageGroup(): string | undefined {
		if (this.currentSession.imageGroup) {
			return this.currentSession.imageGroup;
		}
		const available = this.currentSession.availableGroups || {};
		if ("画图" in available) return "画图";
		for (const [name, info] of Object.entries(available)) {
			const text = `${name} ${info.desc || ""}`.toLowerCase();
			if (
				text.includes("画图") ||
				text.includes("绘图") ||
				text.includes("生图") ||
				text.includes("image") ||
				text.includes("dall") ||
				text.includes("flux")
			) {
				return name;
			}
		}
		return this.currentSession.activeGroup;
	}

	public getImageModel(): string | undefined {
		if (this.currentSession.imageModel) {
			return this.currentSession.imageModel;
		}
		const currentImgGroup = this.getImageGroup();
		const matchedGroup = this.currentSession.groups?.find((g) => g.name === currentImgGroup);
		if (matchedGroup?.imageModels && matchedGroup.imageModels.length > 0) {
			if (matchedGroup.imageModels.includes("gemini-3.1-flash-image")) {
				return "gemini-3.1-flash-image";
			}
			return matchedGroup.imageModels[0];
		}
		return "gemini-3.1-flash-image";
	}

	public async setImageGroup(groupName: string): Promise<{ success: boolean; message?: string }> {
		if (this.preservedEncryptedSession && !this.currentSession.accessToken) {
			return { success: false, message: "凭据暂时无法解密，图像设置未保存；请恢复系统密钥环后重启应用" };
		}
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

		// 2. 注入所有已接入分组中发现的图像模型
		for (const g of this.currentSession.groups ?? []) {
			if (g.imageModels) {
				for (const mId of g.imageModels) {
					if (!result.has(mId)) {
						result.set(mId, {
							id: mId,
							displayName: `${mId} · ${g.name}`,
							modes: ["text-to-image", "image-to-image"],
						});
					}
				}
			}
		}

		return Array.from(result.values());
	}

	public async refreshSyncedGroups(): Promise<void> {
		const groups = [...(this.currentSession.groups || [])];
		for (const g of groups) {
			try {
				await this.syncSingleGroup(g.name);
			} catch (err) {
				log.warn(`Failed to refresh models for group ${g.name}:`, err);
			}
		}
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
			const service = getDesktopModelSettingsService();
			const config = await service.getConfig();

			const validGroups: Api567GroupInfo[] = [];
			let totalModels = 0;

			let configChanged = false;
			for (const g of this.currentSession.groups ?? []) {
				const providerId = getProviderIdForGroup(g.name);
				const provider = config.providers[providerId];
				if (provider?.apiKey && (provider.models?.length ?? 0) > 0) {
					if (provider.headers) {
						for (const [k, v] of Object.entries(provider.headers)) {
							if (typeof v === "string" && containsNonAscii(v)) {
								provider.headers[k] = encodeURIComponent(v);
								configChanged = true;
							}
						}
					}
					const meta = this.currentSession.availableGroups?.[g.name];
					const expectedRatio = meta?.ratio !== undefined ? meta.ratio : (g.ratio ?? 1);
					const expectedDisplayName = `567 · ${g.name} (${expectedRatio}x)`;
					if (provider.displayName !== expectedDisplayName) {
						provider.displayName = expectedDisplayName;
						configChanged = true;
					}

					const modelIds = provider.models?.map((m) => m.id) ?? [];
					validGroups.push({
						...g,
						ratio: expectedRatio,
						enabled: true,
						modelsCount: modelIds.length,
						models: modelIds,
					});
					totalModels += modelIds.length;
				}
			}
			for (const [pId, p] of Object.entries(config.providers || {})) {
				if (pId.startsWith("567api")) {
					if (p.headers) {
						for (const [k, v] of Object.entries(p.headers)) {
							if (typeof v === "string" && containsNonAscii(v)) {
								p.headers[k] = encodeURIComponent(v);
								configChanged = true;
							}
						}
					}
				}
			}
			if (configChanged) {
				await service.replaceConfig(config);
			}

			this.currentSession.groups = validGroups;
			this.currentSession.modelsCount = totalModels;

			if (config.defaultModel?.startsWith("567api")) {
				const currentProviderId = config.defaultModel.split("/")[0];
				const matched = validGroups.find((g) => getProviderIdForGroup(g.name) === currentProviderId);
				if (matched) {
					this.currentSession.activeGroup = matched.name;
				} else {
					this.currentSession.activeGroup = validGroups[0]?.name;
				}
			} else if (validGroups.length > 0) {
				this.currentSession.activeGroup = validGroups[0].name;
			} else {
				this.currentSession.activeGroup = undefined;
			}
			const activeProvider =
				this.currentSession.activeGroup && getProviderIdForGroup(this.currentSession.activeGroup);
			const prefix = activeProvider ? `${activeProvider}/` : undefined;
			return prefix && config.defaultModel?.startsWith(prefix)
				? config.defaultModel.slice(prefix.length)
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
		if (
			!forceRefresh &&
			this.currentSession.availableGroups &&
			Object.keys(this.currentSession.availableGroups).length > 0 &&
			this.currentSession.groupsUpdated
		) {
			const age = Date.now() - new Date(this.currentSession.groupsUpdated).getTime();
			if (age < 10 * 60 * 1000) {
				return this.currentSession.availableGroups;
			}
		}

		try {
			const res = await this.requestWithAuth<{
				success: boolean;
				data?: Record<string, { desc?: string; ratio?: number }>;
			}>(`${this.baseServer}/api/user/groups`);

			if (res.data?.success && res.data.data) {
				const result: Record<string, { desc: string; ratio: number }> = {};
				for (const [k, v] of Object.entries(res.data.data)) {
					result[k] = {
						desc: v.desc ?? "",
						ratio: typeof v.ratio === "number" ? v.ratio : 1,
					};
				}
				this.currentSession.availableGroups = result;
				this.currentSession.groupsUpdated = new Date().toISOString();
				this.saveSession(this.currentSession);
				return result;
			}
		} catch (err) {
			log.warn("Failed to fetch user groups:", err);
		}
		return this.currentSession.availableGroups ?? {};
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

			this.currentSession = {
				isLoggedIn: true,
				authType: "access_token",
				username: displayName,
				loginUsername: userData?.username,
				accessToken: token,
				quota,
				quotaUsd,
				lastUpdated: new Date().toISOString(),
			};
			this.accessTokenRefresh.reset();
			// 登录成功后拉取可用分组元数据，并自动接入核心推荐分组
			await this.getAvailableGroups(true);
			try {
				await this.syncRecommendedGroups();
			} catch (syncErr) {
				log.warn("Auto sync recommended groups failed on token login:", syncErr);
			}
			await this.reconcileWithModelConfig();

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

			// 登录成功后拉取可用分组元数据，并自动接入核心推荐分组
			await this.getAvailableGroups(true);
			try {
				await this.syncRecommendedGroups();
			} catch (syncErr) {
				log.warn("Auto sync recommended groups failed on password login:", syncErr);
			}
			await this.reconcileWithModelConfig();

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
	 * 自动为核心推荐分组同步模型
	 */
	public async syncRecommendedGroups(): Promise<void> {
		const available = await this.getAvailableGroups();
		const availableNames = Object.keys(available);

		const priorityGroups = [
			"反重力Gemini",
			"画图",
			"chat GPT 特价",
			"chat GPT 满血",
			"Anthropic Claude_max",
			"Google Gemini",
			"deepseek官",
			"xAI grok",
		];

		const toSync = priorityGroups.filter((g) => availableNames.includes(g)).slice(0, 2);
		if (toSync.length === 0) {
			toSync.push("");
		}

		log.info(`Syncing recommended groups: ${toSync.join(", ") || "(default)"}`);
		for (const groupName of toSync) {
			try {
				await this.syncSingleGroup(groupName, available[groupName]);
			} catch (err) {
				log.warn(`Failed to sync group ${groupName}:`, err);
			}
		}

		if (!this.currentSession.activeGroup && toSync[0]) {
			this.currentSession.activeGroup = toSync[0];
		}
		if (!this.currentSession.imageGroup && availableNames.includes("画图")) {
			this.currentSession.imageGroup = "画图";
		}
		if (!this.currentSession.imageModel) {
			this.currentSession.imageModel = "gemini-3.1-flash-image";
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
		try {
			log.info(`Ensuring API key for group: "${groupName || "默认分组"}"`);
			const apiKey = await this.resolveOrCreateApiKeyForGroup(groupName);

			log.info(`Fetching models for group: "${groupName || "默认分组"}"`);
			const { modelDefs, imageModelIds } = await this.fetchGroupModelsWithImages(groupName, apiKey);

			const providerId = groupName ? getProviderIdForGroup(groupName) : "567api";
			const meta = groupMeta ?? this.currentSession.availableGroups?.[groupName];
			const ratio =
				meta?.ratio !== undefined ? meta.ratio : (this.currentSession.availableGroups?.[groupName]?.ratio ?? 1);
			const desc = meta?.desc ?? this.currentSession.availableGroups?.[groupName]?.desc ?? "";
			const displayName = groupName ? `567 · ${groupName} (${ratio}x)` : "567 API";

			const service = getDesktopModelSettingsService();
			const config = await service.getConfig();

			config.providers[providerId] = {
				modelOverrides: config.providers[providerId]?.modelOverrides,
				baseUrl: this.baseV1,
				apiKey,
				displayName,
				api: config.providers[providerId]?.api ?? "openai-completions",
				icon: getProviderIconForGroup(groupName),
				headers: { "X-567-Group": encodeURIComponent(groupName || "default") },
				modelsSyncedAt: new Date().toISOString(),
				models: modelDefs,
			};

			const prefix = `${providerId}/`;
			const previousModel = config.defaultModel?.startsWith(prefix)
				? config.defaultModel.slice(prefix.length)
				: undefined;
			if (
				!config.defaultModel ||
				(previousModel !== undefined && !modelDefs.some((model) => model.id === previousModel))
			) {
				const best = pickBestModel(modelDefs);
				if (best) {
					config.defaultModel = `${providerId}/${best.id}`;
				}
			}

			await service.replaceConfig(config);

			const modelIds = modelDefs.map((m) => m.id);
			const groupInfo: Api567GroupInfo = {
				name: groupName || "默认分组",
				desc,
				ratio,
				enabled: true,
				modelsCount: modelDefs.length,
				models: modelIds,
				imageModels: imageModelIds,
			};

			const existingGroups = (this.currentSession.groups ?? []).filter((g) => g.name !== (groupName || "默认分组"));
			existingGroups.push(groupInfo);
			this.currentSession.groups = existingGroups;

			if (!this.currentSession.apiKey) {
				this.currentSession.apiKey = apiKey;
			}
			this.currentSession.modelsCount = (this.currentSession.modelsCount ?? 0) + modelDefs.length;

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
			const providerId = groupName ? getProviderIdForGroup(groupName) : "567api";
			const service = getDesktopModelSettingsService();
			const config = await service.getConfig();

			// 1. 从本地 models.json 移除
			if (config.providers[providerId]) {
				delete config.providers[providerId];
				if (config.defaultModel?.startsWith(`${providerId}/`)) {
					delete config.defaultModel;
				}
				await service.replaceConfig(config);
			}

			// 2. 查找并从中转站服务器删除由 567 Agent 创建的专属令牌，释放 10 个 Token 的配额！
			try {
				const targetName = groupName ? `567 Agent [${groupName}]` : "567 Agent";
				const listRes = await this.requestWithAuth<unknown>(`${this.baseServer}/api/token/?p=0&size=100`);
				const tokens = extractTokens(listRes.data);
				const matched = tokens.find(
					(t) => t.name === targetName || (groupName && t.group === groupName && t.name.startsWith("567 Agent")),
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
			this.currentSession.groups = (this.currentSession.groups ?? []).filter((g) => g.name !== groupName);
			if (this.currentSession.activeGroup === groupName) {
				this.currentSession.activeGroup = this.currentSession.groups[0]?.name;
			}

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
		const providerId = groupName ? getProviderIdForGroup(groupName) : "567api";
		try {
			const service = getDesktopModelSettingsService();
			let config = await service.getConfig();
			let provider = config.providers[providerId];

			// 若本地未配置该 provider 或无有效密钥/模型，先执行自动接入创建 Key 与模型
			if (!provider || !provider.apiKey || !provider.models || provider.models.length === 0) {
				if (modelName !== undefined) return { success: false, message: mainT("api567Model.unavailable") };
				log.info(`Provider ${providerId} not found in models.json, re-syncing group "${groupName}"...`);
				const syncRes = await this.syncSingleGroup(groupName);
				if (!syncRes.success) {
					return { success: false, message: syncRes.message || `未能为分组 [${groupName}] 创建 Key 与接入模型` };
				}
				config = await service.getConfig();
				provider = config.providers[providerId];
			}

			const selected = modelName
				? provider?.models?.find((model) => model.id === modelName)
				: pickBestModel(provider?.models ?? []);
			if (!selected) return { success: false, message: mainT("api567Model.unavailable") };
			config.defaultModel = `${providerId}/${selected.id}`;
			await service.replaceConfig(config);

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
		let models: ModelDefinition[] = [];
		if (groupName) {
			try {
				const res = await this.requestWithAuth<{ success: boolean; data?: unknown }>(
					`${this.baseServer}/api/user/models?group=${encodeURIComponent(groupName)}`,
				);
				if (res.data?.success) models = parseModelList(res.data.data);
			} catch (error) {
				log.warn("Could not fetch group model metadata", error);
			}
		}
		if (models.length === 0 || models.some((model) => model.contextWindow === undefined)) {
			try {
				const res = await request<{ data?: unknown }>(`${this.baseV1}/models`, {
					headers: {
						Authorization: `Bearer ${apiKey}`,
						"X-567-Group": encodeURIComponent(groupName || "default"),
					},
				});
				const listed = parseModelList(res.data?.data);
				if (models.length === 0) models = listed;
				else {
					const metadata = new Map(listed.map((model) => [model.id, model]));
					models = models.map((model) =>
						model.contextWindow !== undefined ? model : (metadata.get(model.id) ?? model),
					);
				}
			} catch (error) {
				log.warn("Could not fetch compatible model metadata", error);
			}
		}
		const desc = this.currentSession.availableGroups?.[groupName]?.desc || "";
		const isDrawingGroup = /画图|绘图|生图|image|draw|paint|flux/i.test(`${groupName} ${desc}`);
		const imageModelIds = models
			.filter(
				(model) =>
					/dall-e|image|imagen|flux|midjourney|draw|paint|diffusion|agnes/i.test(model.id) || isDrawingGroup,
			)
			.map((model) => model.id);
		const filtered = isDrawingGroup ? models : models.filter((model) => !NON_CHAT.test(model.id));
		const chatModels = filtered.length > 0 ? filtered : models;
		const catalog = await listPresetProviders();
		return {
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
		return this.resolveOrCreateApiKeyForGroup(groupName);
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

	/**
	 * 刷新用户余额
	 */
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
		this.accessTokenRefresh.reset();
		try {
			removeAccountCredentials(getDesktopCredentialVault());
		} catch (error) {
			log.warn("Could not remove saved 567 API account credentials:", error);
		}
		this.saveSession({ isLoggedIn: false });

		try {
			const service = getDesktopModelSettingsService();
			const config = await service.getConfig();
			for (const id of Object.keys(config.providers)) {
				if (id.startsWith("567api")) {
					delete config.providers[id];
				}
			}
			if (config.defaultModel?.startsWith("567api")) {
				delete config.defaultModel;
			}
			await service.replaceConfig(config);
		} catch (err) {
			log.warn("Failed to clear 567api providers from models.json:", err);
		}

		log.info("567api logged out");
	}
}
