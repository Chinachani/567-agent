import { resolveNodeConfigurationHeaders, resolveNodeConfigurationValue } from "@567agent/runtime-node/host";
import { net } from "electron";
import type { FetchedProviderModelsResult } from "../../preload/api-types/models.js";
import { mainT } from "../i18n/index.js";
import { getDesktopModelCredentialStore } from "./model-credential-store.js";
import { getDesktopModelSettingsService } from "./model-settings-host.js";
import { parseProviderModels } from "./parse-provider-models.js";

/**
 * 拉取本地自定义 provider 的 `GET {baseUrl}/models`（OpenAI 兼容接口），
 * 返回上游模型 id 列表，供设置页「从接口拉取」批量填写模型配置。
 *
 * 仅面向本地 models.json 里的 provider（Ollama / vLLM / LM Studio / 任意
 * openai-compatible 网关）。apiKey / headers 沿用 coding-agent 的解析规则
 * （`!command` 执行、环境变量名、字面量）。
 *
 * 与 probeModelProvider 一样走 electron.net.fetch，以复用 GUI session 的
 * 网络栈，绕开 macOS 15 本地网络权限限制。
 */
export async function fetchProviderModels(providerName: string): Promise<FetchedProviderModelsResult> {
	const config = await getDesktopModelSettingsService().getConfig();
	const provider = config.providers[providerName];
	if (!provider) return { models: [], error: mainT("providerModels.missingProvider") };
	if (!provider.baseUrl) return { models: [], error: mainT("providerModels.missingUrl") };

	let url: string;
	try {
		url = `${new URL(provider.baseUrl).toString().replace(/\/$/, "")}/models`;
	} catch {
		return { models: [], error: mainT("providerModels.invalidUrl") };
	}

	const headers: Record<string, string> = { ...resolveNodeConfigurationHeaders(provider.headers) };
	const key = provider.credentialRef
		? getDesktopModelCredentialStore().get(provider.credentialRef)
		: provider.apiKey && provider.apiKey !== "***"
			? resolveNodeConfigurationValue(provider.apiKey)
			: undefined;
	if ((provider.credentialRef || provider.apiKey === "***") && !key)
		return { models: [], error: mainT("providerModels.missingKey") };
	if (key && provider.authHeader !== false) headers.Authorization = `Bearer ${key}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const res = await net.fetch(url, { method: "GET", headers, signal: controller.signal });
		if (!res.ok) return { models: [], error: mainT("providerModels.httpError", { status: res.status }) };
		const body: unknown = await res.json();
		const modelDefinitions = parseProviderModels(body);
		const models = modelDefinitions.map((model) => model.id);
		if (models.length === 0) return { models: [], error: mainT("providerModels.empty") };
		return { models, modelDefinitions };
	} catch {
		return {
			models: [],
			error: mainT(controller.signal.aborted ? "providerModels.timeout" : "providerModels.network"),
		};
	} finally {
		clearTimeout(timer);
	}
}
