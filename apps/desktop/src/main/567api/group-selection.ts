import { createHash } from "node:crypto";
import { getBuiltinApi567Route } from "../../shared/service-routes.js";
import type { ModelDefinition, ModelsConfig } from "../models/model-settings-service.js";

export const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";

const GROUP_PROVIDER_MAP: Record<string, string> = {
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

export function getProviderIdForGroup(groupName: string): string {
	// Persisted provider IDs use the server's exact group name. Normalize only when choosing a default.
	if (Object.hasOwn(GROUP_PROVIDER_MAP, groupName)) return GROUP_PROVIDER_MAP[groupName];
	const asciiSlug = groupName
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "")
		.slice(0, 16);
	if (asciiSlug.length >= 3) return `567api_${asciiSlug}`;
	const hash = createHash("md5").update(groupName).digest("hex").slice(0, 8);
	return `567api_${hash}`;
}

export function providerIdForGroupName(groupName: string): string {
	return !groupName || groupName === "默认分组" ? "567api" : getProviderIdForGroup(groupName);
}

export function isImageOnlyGroup(name: string, desc?: string): boolean {
	return /画图|绘图|生图|image|dall|draw|paint|flux/i.test(`${name} ${desc ?? ""}`);
}

export function isGroupAvailable(
	available: Record<string, { desc: string; ratio: number }>,
	groupName: string,
): boolean {
	if (groupName === "默认分组") {
		return Object.hasOwn(available, "") || Object.hasOwn(available, "default") || Object.hasOwn(available, groupName);
	}
	return Object.hasOwn(available, groupName);
}

export function isManaged567Provider(
	providerId: string,
	provider: { baseUrl?: string; source?: string } | undefined,
	trustedOrigins: readonly string[],
): boolean {
	if (providerId !== "567api" && !providerId.startsWith("567api_")) return false;
	if (!provider || provider.source === "template") return false;
	if (provider.baseUrl !== undefined) {
		return getBuiltinApi567Route(provider.baseUrl, trustedOrigins) !== undefined;
	}
	return true;
}

export function mergeGroupModelsPreservingManualEdits(
	remoteModels: ModelDefinition[],
	existingModels: ModelDefinition[] | undefined,
): ModelDefinition[] {
	if (!existingModels?.length) return remoteModels;
	const existingById = new Map(existingModels.map((model) => [model.id, model]));
	return remoteModels.map((remote) => {
		const existing = existingById.get(remote.id);
		if (!existing) return remote;
		const definedExisting = Object.fromEntries(
			Object.entries(existing).filter(([, value]) => value !== undefined),
		) as Partial<ModelDefinition>;
		return { ...remote, ...definedExisting };
	});
}

export function isValidModelKeyInConfig(config: ModelsConfig, modelKey: string | undefined): boolean {
	if (!modelKey) return false;
	const slash = modelKey.indexOf("/");
	if (slash <= 0) return false;
	const provider = config.providers[modelKey.slice(0, slash)];
	if (!provider || provider.disabled) return false;
	const models = provider.models ?? [];
	return models.length > 0 && models.some((model) => model.id === modelKey.slice(slash + 1));
}

export function getAccountIdentityKey(session: {
	isLoggedIn: boolean;
	authType?: "access_token" | "account";
	loginUsername?: string;
	username?: string;
}): string {
	if (!session.isLoggedIn) return "";
	return `${session.authType ?? ""}:${session.loginUsername || session.username || ""}`;
}
