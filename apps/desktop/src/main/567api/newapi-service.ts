function getModelScore(id: string): number {
	const lower = id.toLowerCase();
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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import { join } from "node:path";

function getVettaHomePath(): string {
	const explicit = process.env.VETTA_HOME;
	if (explicit) return explicit;
	const dirName = process.env.VETTA_CONFIG_DIR || ".vetta";
	return join(os.homedir(), dirName);
}

import { BrowserWindow } from "electron";
import { getAppLogger } from "../logger.js";
import { getDesktopModelSettingsService } from "../models/model-settings-host.js";
import type { ModelDefinition } from "../models/model-settings-service.js";
import { containsNonAscii, decryptSecret, encryptSecret, getSecurityHeaders } from "./security.js";

const log = getAppLogger("567api");

const BASE_SERVER = "https://api.567.wiki";
const BASE_V1 = "https://api.567.wiki/v1";
const QUOTA_PER_USD = 500000;

export interface Api567GroupInfo {
	name: string;
	desc: string;
	ratio: number;
	enabled: boolean;
	modelsCount?: number;
	models?: string[];
}

export interface Api567Session {
	isLoggedIn: boolean;
	authType?: "access_token" | "account";
	username?: string;
	accessToken?: string;
	apiKey?: string;
	quota?: number;
	quotaUsd?: number;
	cookie?: string;
	activeGroup?: string;
	groups?: Api567GroupInfo[];
	availableGroups?: Record<string, { desc: string; ratio: number }>;
	lastUpdated?: string;
	groupsUpdated?: string;
	modelsCount?: number;
}

export interface Api567Status {
	isLoggedIn: boolean;
	authType?: "access_token" | "account";
	username?: string;
	apiKeyMasked?: string;
	quota?: number;
	quotaUsd?: number;
	activeGroup?: string;
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
	return join(getVettaHomePath(), "567api-session.json");
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
			},
			(res) => {
				let raw = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => {
					raw += chunk;
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
	};
	if (map[groupName]) return map[groupName];
	const slug = groupName
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "_")
		.slice(0, 20);
	return `567api_${slug || "custom"}`;
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

function inferModelParams(modelId: string): { contextWindow: number; maxTokens: number } {
	const lower = modelId.toLowerCase();
	if (lower.includes("1m") || lower.includes("gemini")) {
		return { contextWindow: 1000000, maxTokens: 8192 };
	}
	if (lower.includes("claude")) {
		return { contextWindow: 200000, maxTokens: 8192 };
	}
	if (lower.includes("o1") || lower.includes("o3")) {
		return { contextWindow: 200000, maxTokens: 65536 };
	}
	if (lower.includes("gpt-4o")) {
		return { contextWindow: 128000, maxTokens: 4096 };
	}
	if (lower.includes("deepseek")) {
		return { contextWindow: 64000, maxTokens: 8192 };
	}
	return { contextWindow: 128000, maxTokens: 4096 };
}

const NON_CHAT =
	/embedding|embed|whisper|tts|audio|realtime|-live-|moderation|dall-e|image|transcribe|rerank|vision-ocr|veo-|lyria|imagen|deep-research|computer-use|-character|livetranslate/i;

export class NewApiService {
	private static instance: NewApiService;
	private currentSession: Api567Session = { isLoggedIn: false };

	private constructor() {
		this.loadSession();
	}

	public static getInstance(): NewApiService {
		if (!NewApiService.instance) {
			NewApiService.instance = new NewApiService();
		}
		return NewApiService.instance;
	}

	public async getStatus(): Promise<Api567Status> {
		await this.reconcileWithModelConfig();
		return {
			isLoggedIn: this.currentSession.isLoggedIn,
			authType: this.currentSession.authType,
			username: this.currentSession.username,
			apiKeyMasked: this.currentSession.apiKey
				? `${this.currentSession.apiKey.slice(0, 7)}...${this.currentSession.apiKey.slice(-4)}`
				: undefined,
			quota: this.currentSession.quota,
			quotaUsd: this.currentSession.quotaUsd,
			activeGroup: this.currentSession.activeGroup,
			groups: this.currentSession.groups,
			availableGroups: this.currentSession.availableGroups,
			lastUpdated: this.currentSession.lastUpdated,
			modelsCount: this.currentSession.modelsCount,
		};
	}

	public getRawSession(): Api567Session {
		return { ...this.currentSession };
	}

	private loadSession(): void {
		try {
			const path = getSessionFilePath();
			if (existsSync(path)) {
				const content = readFileSync(path, "utf8");
				const raw = JSON.parse(content);
				this.currentSession = {
					...raw,
					accessToken: decryptSecret(raw.accessToken),
					apiKey: decryptSecret(raw.apiKey),
					cookie: decryptSecret(raw.cookie),
				};
				if (this.currentSession.isLoggedIn && !this.currentSession.accessToken) {
					void this.ensureValidAccessToken().catch((err) => {
						log.warn("Stale session detected without valid token, clearing session:", err);
						this.currentSession = { isLoggedIn: false };
						this.saveSession(this.currentSession);
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
			writeFileSync(path, JSON.stringify(toSave, null, 2), "utf8");
			void this.broadcastStatus();
		} catch (err) {
			log.error("Failed to save 567api session:", err);
		}
	}

	public async broadcastStatus(): Promise<void> {
		const status = await this.getStatus();
		for (const win of BrowserWindow.getAllWindows()) {
			if (!win.isDestroyed()) {
				win.webContents.send("vetta:567api:status-changed", status);
			}
		}
	}

	/**
	 * 与本地 models.json 对齐状态，确保当用户在模型设置里删除服务商/Key后，状态能够立即感知并重置
	 */
	public async reconcileWithModelConfig(): Promise<void> {
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
					if (provider.api !== "openai-completions") {
						provider.api = "openai-completions";
						configChanged = true;
					}
					if (provider.headers) {
						for (const [k, v] of Object.entries(provider.headers)) {
							if (typeof v === "string" && containsNonAscii(v)) {
								provider.headers[k] = encodeURIComponent(v);
								configChanged = true;
							}
						}
					}
					const modelIds = provider.models?.map((m) => m.id) ?? [];
					validGroups.push({
						...g,
						enabled: true,
						modelsCount: modelIds.length,
						models: modelIds,
					});
					totalModels += modelIds.length;
				}
			}
			for (const [pId, p] of Object.entries(config.providers || {})) {
				if (pId.startsWith("567api")) {
					if (p.api !== "openai-completions") {
						p.api = "openai-completions";
						configChanged = true;
					}
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
			try {
				const refreshRes = await request<{
					success: boolean;
					data?: {
						access_token?: string;
						user?: { quota?: number; username?: string; display_name?: string };
					};
				}>(`${BASE_SERVER}/api/user/auth/refresh`, {
					method: "POST",
					headers: { Cookie: this.currentSession.cookie },
				});

				const rawCookies = refreshRes.headers["set-cookie"];
				if (rawCookies) {
					const cookieHeader = (Array.isArray(rawCookies) ? rawCookies : [rawCookies])
						.map((c) => c.split(";")[0])
						.join("; ");
					this.currentSession.cookie = cookieHeader;
				}

				if (refreshRes.data?.success && refreshRes.data.data?.access_token) {
					this.currentSession.accessToken = refreshRes.data.data.access_token;
					const userData = refreshRes.data.data.user;
					if (userData) {
						if (typeof userData.quota === "number") {
							this.currentSession.quota = userData.quota;
							this.currentSession.quotaUsd = Number((userData.quota / QUOTA_PER_USD).toFixed(2));
						}
						if (userData.display_name || userData.username) {
							this.currentSession.username = userData.display_name || userData.username;
						}
					}
					this.saveSession(this.currentSession);
					return this.currentSession.accessToken;
				}
			} catch (err) {
				log.warn("Failed to refresh access token:", err);
			}
		}

		throw new Error("567 API 会话已过期，请重新登录");
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

		if (res.status === 401 && this.currentSession.cookie && this.currentSession.authType === "account") {
			log.warn("Access token expired (HTTP 401), refreshing token and retrying request...");
			this.currentSession.accessToken = undefined;
			try {
				token = await this.ensureValidAccessToken();
				res = await request<T>(urlStr, {
					...options,
					headers: {
						...options.headers,
						Authorization: `Bearer ${token}`,
					},
				});
			} catch (refreshErr) {
				log.warn("Failed to refresh token after 401:", refreshErr);
			}
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
			}>(`${BASE_SERVER}/api/user/groups`);

			if (res.data?.success && res.data.data) {
				const result: Record<string, { desc: string; ratio: number }> = {};
				for (const [k, v] of Object.entries(res.data.data)) {
					if (k.includes("画图") || k.includes("视频")) continue;
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
			}>(`${BASE_SERVER}/api/user/self`, {
				headers: { Authorization: `Bearer ${token}` },
			});

			if (!selfRes.data || !selfRes.data.success || !selfRes.data.data) {
				return {
					success: false,
					message: selfRes.data?.message || `账户访问令牌验证失败 (HTTP ${selfRes.status})`,
				};
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
				accessToken: token,
				quota,
				quotaUsd,
				lastUpdated: new Date().toISOString(),
			};

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
			}>(`${BASE_SERVER}/api/user/login`, {
				method: "POST",
				body: { username: username.trim(), password: password.trim() },
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
				accessToken,
				cookie: cookieHeader,
				quota,
				quotaUsd,
				lastUpdated: new Date().toISOString(),
			};

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
			return { success: false, message: err instanceof Error ? err.message : String(err) };
		}
	}

	/**
	 * 自动为核心推荐分组同步模型
	 */
	public async syncRecommendedGroups(): Promise<void> {
		const available = await this.getAvailableGroups();
		const availableNames = Object.keys(available);

		const priorityGroups = [
			"chat GPT 满血",
			"Anthropic Claude_max",
			"Google Gemini",
			"deepseek官",
			"xAI grok",
			"反重力Gemini",
			"chat GPT 特价",
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
	}

	/**
	 * 获取指定 Token 的完整未脱敏 Key
	 */
	private async fetchFullKey(tokenId: number): Promise<string | undefined> {
		try {
			const keyRes = await this.requestWithAuth<{
				success: boolean;
				data?: { key?: string } | string;
			}>(`${BASE_SERVER}/api/token/${tokenId}/key`, {
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
			const modelDefs = await this.fetchGroupModels(groupName, apiKey);

			const providerId = groupName ? getProviderIdForGroup(groupName) : "567api";
			const ratio = groupMeta?.ratio ?? 1;
			const desc = groupMeta?.desc ?? "";
			const displayName = groupName ? `567 · ${groupName} (${ratio}x)` : "567 API";

			const service = getDesktopModelSettingsService();
			const config = await service.getConfig();

			config.providers[providerId] = {
				baseUrl: BASE_V1,
				apiKey,
				displayName,
				api: "openai-completions",
				icon: getProviderIconForGroup(groupName),
				headers: getSecurityHeaders({ "X-567-Group": encodeURIComponent(groupName || "default") }),
				modelsSyncedAt: new Date().toISOString(),
				models: modelDefs,
			};

			if (!config.defaultModel || config.defaultModel.startsWith(`${providerId}/`)) {
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
				const listRes = await this.requestWithAuth<unknown>(`${BASE_SERVER}/api/token/?p=0&size=100`);
				const tokens = extractTokens(listRes.data);
				const matched = tokens.find(
					(t) => t.name === targetName || (groupName && t.group === groupName && t.name.startsWith("567 Agent")),
				);
				if (matched) {
					log.info(`Deleting remote token id=${matched.id} ("${matched.name}") from NewAPI server...`);
					await this.requestWithAuth(`${BASE_SERVER}/api/token/${matched.id}`, {
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
	 * 设置当前主力分组：如果该分组在 models.json 中缺失（例如被用户手动删除），自动重新创建 Key 并接入！
	 */
	public async setActiveGroup(groupName: string): Promise<{ success: boolean; message?: string }> {
		const providerId = groupName ? getProviderIdForGroup(groupName) : "567api";
		try {
			const service = getDesktopModelSettingsService();
			let config = await service.getConfig();
			let provider = config.providers[providerId];

			// 若本地未配置该 provider 或无有效密钥/模型，先执行自动接入创建 Key 与模型
			if (!provider || !provider.apiKey || !provider.models || provider.models.length === 0) {
				log.info(`Provider ${providerId} not found in models.json, re-syncing group "${groupName}"...`);
				const syncRes = await this.syncSingleGroup(groupName);
				if (!syncRes.success) {
					return { success: false, message: syncRes.message || `未能为分组 [${groupName}] 创建 Key 与接入模型` };
				}
				config = await service.getConfig();
				provider = config.providers[providerId];
			}

			if (provider?.models && provider.models.length > 0) {
				const best = pickBestModel(provider.models);
				config.defaultModel = `${providerId}/${best?.id || provider.models[0].id}`;
				await service.replaceConfig(config);
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
	private async fetchGroupModels(groupName: string, apiKey: string): Promise<ModelDefinition[]> {
		let modelIds: string[] = [];

		if (groupName) {
			try {
				const res = await this.requestWithAuth<{
					success: boolean;
					data?: string[];
				}>(`${BASE_SERVER}/api/user/models?group=${encodeURIComponent(groupName)}`);
				if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
					modelIds = res.data.data;
				}
			} catch (err) {
				log.warn(`Failed to fetch models from /api/user/models for group ${groupName}:`, err);
			}
		}

		if (modelIds.length === 0) {
			try {
				const res = await request<{
					data?: Array<{ id: string }>;
				}>(`${BASE_V1}/models`, {
					headers: { Authorization: `Bearer ${apiKey}` },
				});
				if (res.data?.data && Array.isArray(res.data.data)) {
					modelIds = res.data.data.map((m) => m.id);
				}
			} catch (err) {
				log.warn(`Failed to fetch models from /v1/models for group ${groupName}:`, err);
			}
		}

		const chatModels = modelIds.filter((id) => !NON_CHAT.test(id));
		const finalModels = chatModels.length > 0 ? chatModels : modelIds;

		return finalModels.map((id) => ({
			id,
			name: id,
			input: ["text", "image"],
			...inferModelParams(id),
		}));
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

		// 1. 获取用户所有现有令牌
		let existingTokens: RawNewApiToken[] = [];
		try {
			const listRes = await this.requestWithAuth<unknown>(`${BASE_SERVER}/api/token/?p=0&size=100`);
			existingTokens = extractTokens(listRes.data);
			log.info(`Found ${existingTokens.length} existing tokens in user account`);
		} catch (err) {
			log.warn("Failed to fetch token list:", err);
		}

		// 2. 匹配已有令牌（优先名称或分组完全匹配）
		let matched = existingTokens.find((t) => t.status === 1 && t.name === targetName);

		if (!matched && groupName) {
			matched = existingTokens.find((t) => t.status === 1 && (t.group === groupName || t.name.includes(groupName)));
		}

		if (!matched && !groupName) {
			matched = existingTokens.find((t) => t.status === 1 && t.name.startsWith("567 Agent"));
		}

		// 3. 如果匹配到已有令牌，获取明文 Key 并复用
		if (matched) {
			log.info(`Found matching token id=${matched.id}, name="${matched.name}", group="${matched.group || ""}"`);
			if (matched.key && !matched.key.includes("*") && matched.key.length >= 20) {
				const clean = matched.key.trim();
				return clean.startsWith("sk-") ? clean : `sk-${clean}`;
			}
			const fullKey = await this.fetchFullKey(matched.id);
			if (fullKey) {
				log.info(`Successfully fetched unmasked key for token id=${matched.id}`);
				return fullKey;
			}
		}

		// 4. 若未找到但令牌数已达上限（>= 10），复用或更新现有的可用令牌
		if (existingTokens.length >= 10) {
			log.warn(`Token limit (10) reached, attempting to update or reuse existing token for "${targetName}"...`);
			const candidate = existingTokens.find((t) => t.name.startsWith("567 Agent")) || existingTokens[0];
			if (candidate) {
				if (groupName && candidate.group !== groupName) {
					try {
						log.info(`Updating token id=${candidate.id} to group "${groupName}"...`);
						await this.requestWithAuth(`${BASE_SERVER}/api/token/`, {
							method: "PUT",
							body: {
								id: candidate.id,
								name: targetName,
								group: groupName,
								remain_quota: candidate.remain_quota ?? 0,
								unlimited_quota: candidate.unlimited_quota ?? true,
								expired_time: -1,
							},
						});
					} catch (err) {
						log.warn(`Failed to update token ${candidate.id} group:`, err);
					}
				}

				const fullKey = await this.fetchFullKey(candidate.id);
				if (fullKey) {
					return fullKey;
				}
			}
		}

		// 5. 若未达到上限，调用 POST /api/token/ 创建专属分组令牌
		log.info(`Creating new token: "${targetName}" for group: "${groupName || "默认"}"...`);
		const createRes = await this.requestWithAuth<{
			success: boolean;
			message?: string;
			data?: { id: number; key?: string };
		}>(`${BASE_SERVER}/api/token/`, {
			method: "POST",
			body: {
				name: targetName,
				group: groupName || undefined,
				remain_quota: 0,
				expired_time: -1,
				unlimited_quota: true,
			},
		});

		if (createRes.data?.success) {
			// New API 的 POST /api/token/ 成功时仅返回 { success: true, message: "" }，不包含 data.id
			// 立即重新拉取令牌列表获取刚创建的令牌与明文 Key
			log.info(`Token "${targetName}" created successfully on server, fetching unmasked key...`);
			const reloadRes = await this.requestWithAuth<unknown>(`${BASE_SERVER}/api/token/?p=0&size=100`);
			const reloadedTokens = extractTokens(reloadRes.data);
			const newlyCreated =
				reloadedTokens.find(
					(t) =>
						t.status === 1 &&
						(t.name === targetName || (groupName && t.group === groupName && t.name.startsWith("567 Agent"))),
				) || reloadedTokens[0];

			if (newlyCreated) {
				const fullKey = await this.fetchFullKey(newlyCreated.id);
				if (fullKey) return fullKey;
				if (newlyCreated.key && !newlyCreated.key.includes("*") && newlyCreated.key.length >= 20) {
					const clean = newlyCreated.key.trim();
					return clean.startsWith("sk-") ? clean : `sk-${clean}`;
				}
			}
		}

		throw new Error(
			createRes.data?.message ||
				`未能获取或创建 567 Agent 专属 API 访问密钥 (当前账户已有 ${existingTokens.length} 个令牌)`,
		);
	}

	/**
	 * 刷新用户余额
	 */
	public async refreshQuota(force = false): Promise<{ success: boolean; quota?: number; quotaUsd?: number }> {
		if (!this.currentSession.isLoggedIn) {
			return { success: false };
		}

		if (!force && this.currentSession.quota !== undefined && this.currentSession.lastUpdated) {
			const age = Date.now() - new Date(this.currentSession.lastUpdated).getTime();
			if (age < 30 * 1000) {
				return {
					success: true,
					quota: this.currentSession.quota,
					quotaUsd: this.currentSession.quotaUsd,
				};
			}
		}

		try {
			const res = await this.requestWithAuth<{
				success: boolean;
				data?: {
					quota?: number;
					user?: { quota?: number };
				};
			}>(`${BASE_SERVER}/api/user/self`);

			if (res.data?.success && res.data.data) {
				const userData = res.data.data.user || res.data.data;
				if (typeof userData.quota === "number") {
					const quota = userData.quota;
					const quotaUsd = Number((quota / QUOTA_PER_USD).toFixed(2));
					this.saveSession({
						...this.currentSession,
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
	}

	/**
	 * 退出登录
	 */
	public async logout(): Promise<void> {
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
