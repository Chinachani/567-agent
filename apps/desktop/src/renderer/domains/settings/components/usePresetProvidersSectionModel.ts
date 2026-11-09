import type { ModelsConfigData, PresetError, PresetProviderInfo } from "@preload/api.js";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { showToast } from "@shared/store/toast-atoms";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isMagpieBaseUrl } from "@/shared/preset-provider-url";
import { isInvalidKey, translatePresetError } from "./translatePresetError";

type ProviderEntry = ModelsConfigData["providers"][string];
type ModelCost = { input: number; output: number; cacheRead: number; cacheWrite: number };
type CostLabelKey = "costInput" | "costCacheRead" | "costCacheWrite" | "costOutput";

export interface PresetProviderModelRow {
	id: string;
	name: string;
	contextWindow?: number;
	hasVision: boolean;
	hasReasoning: boolean;
	reasoningLevels?: string[];
	price: string | null;
}

export interface PresetProviderRow {
	id: string;
	displayName: string;
	api: string;
	baseUrl?: string;
	icon?: string;
	/** 预填密钥:草稿为空时作为输入框初值,点启用即用。 */
	defaultApiKey?: string;
	models: NonNullable<ProviderEntry["models"]>;
	modelRows: PresetProviderModelRow[];
	offline: boolean;
	adopted: boolean;
	/** 已采纳且未被用户手动停用:开关的状态。 */
	enabled: boolean;
	/** 内置固定密钥(本机代理类):只给开关,不让用户填 key。 */
	autoKey: boolean;
	isOpen: boolean;
	isExpanded: boolean;
	refreshing: boolean;
	hasApiKey: boolean;
	/** 该行最近一次拉取模型失败的原因。 */
	modelsError: string | null;
}

export interface PresetProvidersSectionLabels {
	title: string;
	loading: string;
	noPresetProviders: string;
	enabled: string;
	deprecated: string;
	collapseModels: string;
	viewModels: string;
	modelsCount: (count: number) => string;
	collapse: string;
	cancel: string;
	changeKey: string;
	remove: string;
	enable: string;
	apiKeyDirect: (provider: string) => string;
	apiKeyPlaceholder: string;
	encryptedApiKeyPlaceholder: string;
	save: string;
	noModels: string;
	noMatchingModels: string;
	searchModels: (provider: string) => string;
	clearModelSearch: string;
	modelListLabel: (provider: string) => string;
	thinking: string;
	perMillionTokens: string;
	refreshModels: string;
	refreshingModels: string;
	refreshCatalog: string;
	copyApiKey: string;
	magpiePortHint: string;
	editBaseUrl: string;
	baseUrlPlaceholder: string;
	testConnect: string;
	testing: string;
	testOk: string;
	testFailed: string;
	toggleProvider: (provider: string) => string;
}

export interface PresetProvidersSectionModel {
	rows: PresetProviderRow[];
	error: string | null;
	loading: boolean;
	/** Per-provider draft API keys (always-visible enable inputs need independent drafts). */
	draftKeys: Record<string, string>;
	saving: boolean;
	labels: PresetProvidersSectionLabels;
	onToggleExpanded: (row: PresetProviderRow) => void;
	onToggleEditor: (row: PresetProviderRow) => void;
	onDraftKeyChange: (rowId: string, key: string) => void;
	onAdopt: (row: PresetProviderRow) => Promise<boolean>;
	onToggleEnabled: (row: PresetProviderRow, next: boolean) => Promise<void>;
	/** 返回是否已保存,用于输入框决定是否收起。 */
	onChangeBaseUrl: (row: PresetProviderRow, url: string) => Promise<boolean>;
	onRemove: (row: PresetProviderRow) => Promise<void>;
	onRefreshModels: (row: PresetProviderRow) => Promise<void>;
	onCopyApiKey: (row: PresetProviderRow) => Promise<void>;
	/** 手动重拉公共目录(models.dev)。 */
	refreshingCatalog: boolean;
	onRefreshCatalog: () => Promise<void>;
}

export function usePresetProvidersSectionModel({
	config,
	saveConfig,
}: {
	config: ModelsConfigData;
	saveConfig: (config: ModelsConfigData) => Promise<boolean>;
}): PresetProvidersSectionModel {
	const { t, i18n } = useTranslation("settings");
	const [presets, setPresets] = useState<PresetProviderInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	/** Only used for adopted providers' "change key" panel. */
	const [openId, setOpenId] = useState<string | null>(null);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);
	const [refreshingId, setRefreshingId] = useState<string | null>(null);
	const [modelsErrors, setModelsErrors] = useState<Record<string, string>>({});
	const [refreshingCatalog, setRefreshingCatalog] = useState(false);

	const inFlight = useRef(false);
	const alive = useRef(true);
	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
		};
	}, []);
	const mutate = useCallback(
		async (operation: () => Promise<boolean>): Promise<boolean> => {
			if (inFlight.current) return false;
			inFlight.current = true;
			setSaving(true);
			try {
				await waitForCommittedPaint();
				return alive.current ? await operation() : false;
			} catch {
				if (alive.current) showToast({ variant: "error", message: t("modelSettingsFeedback.saveFailed") });
				return false;
			} finally {
				inFlight.current = false;
				if (alive.current) setSaving(false);
			}
		},
		[t],
	);
	const saveProvider = useCallback(
		async (
			id: string,
			update: (previous: ProviderEntry | undefined) => ProviderEntry | undefined,
		): Promise<boolean> => {
			const latest = await window.agent567.models.get();
			const provider = update(latest.providers[id]);
			const providers = { ...latest.providers };
			if (provider) providers[id] = provider;
			else delete providers[id];
			const defaultModel = !provider && latest.defaultModel?.startsWith(`${id}/`) ? undefined : latest.defaultModel;
			return (await saveConfig({ ...latest, defaultModel, providers })) !== false;
		},
		[saveConfig],
	);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await window.agent567.models.listPresets();
			setPresets(result.providers.filter((provider) => provider.id !== "567api"));
			// 公共目录连缓存都没有时把原因摆出来,别让用户对着 0 个模型猜。
			if (result.catalogError) {
				console.error(
					`[preset-providers] models.dev 公共目录不可达，已退到随包快照（${result.catalogFetchedAt ?? "?"}）：`,
					result.catalogError,
				);
				const time = result.catalogFetchedAt ? formatSyncedAt(result.catalogFetchedAt, i18n.language) : "?";
				setError(`${t("catalogUnavailable", { time })} ${translatePresetError(result.catalogError, t)}`);
			} else {
				setError(null);
			}
		} catch {
			setError(t("fetchFailed"));
		} finally {
			setLoading(false);
		}
	}, [i18n.language, t]);

	useEffect(() => {
		void load();
		// 目录是后台刷新的:拉到新数据后重新列一遍,不必让用户手动重试。
		return window.agent567.models.onPresetsUpdated(() => void load());
	}, [load]);

	const rows = useMemo(() => {
		const presetIds = new Set(presets.map((preset) => preset.id));
		// 早期由服务端模板采纳、现已不在内置目录里的条目:保留展示,标记为已下线。
		const orphaned: BaseRow[] = Object.entries(config.providers)
			.filter(([id, provider]) => provider.source === "template" && id !== "567api" && !presetIds.has(id))
			.map(([id, provider]) => ({
				id,
				displayName: provider.displayName ?? id,
				api: provider.api ?? "",
				baseUrl: provider.baseUrl,
				icon: provider.icon,
				models: provider.models ?? [],
				offline: true,
			}));
		const presetRows: BaseRow[] = presets.map((preset) => ({
			id: preset.id,
			displayName: preset.displayName,
			api: preset.api,
			baseUrl: config.providers[preset.id]?.baseUrl ?? preset.baseUrl,
			icon: preset.icon,
			defaultApiKey: preset.defaultApiKey,
			// 已启用的用账号实际可用的 /models 结果,未启用的展示 models.dev 公共目录。
			models: config.providers[preset.id]?.models ?? preset.catalogModels,
			offline: false,
		}));

		return [...presetRows, ...orphaned].map((row) => {
			const adopted = config.providers[row.id]?.source === "template";
			return {
				...row,
				modelRows: row.models.map((model) => toModelRow(model, t)),
				adopted,
				enabled: adopted && !config.providers[row.id]?.disabled,
				autoKey: Boolean(row.defaultApiKey),
				isOpen: openId === row.id,
				isExpanded: expandedId === row.id,
				refreshing: refreshingId === row.id,
				hasApiKey: Boolean(config.providers[row.id]?.apiKey),
				modelsError: modelsErrors[row.id] ?? null,
			};
		});
	}, [config.providers, expandedId, modelsErrors, openId, presets, refreshingId, t]);

	const handleToggleEditor = useCallback((row: PresetProviderRow): void => {
		if (row.isOpen) {
			setOpenId(null);
			return;
		}
		setOpenId(row.id);
		setDraftKeys((prev) => ({
			...prev,
			[row.id]: prev[row.id] ?? "",
		}));
	}, []);

	const handleToggleExpanded = useCallback((row: PresetProviderRow): void => {
		setExpandedId(row.isExpanded ? null : row.id);
	}, []);

	const handleDraftKeyChange = useCallback((rowId: string, key: string): void => {
		setDraftKeys((prev) => ({ ...prev, [rowId]: key }));
	}, []);

	const copyApiKey = useCallback(
		async (row: PresetProviderRow): Promise<void> => {
			try {
				const copied = await window.agent567.models.copyApiKey(row.id);
				showToast({
					variant: copied ? "success" : "error",
					message: t(copied ? "apiKeyCopied" : "apiKeyCopyFailed"),
				});
			} catch {
				showToast({ variant: "error", message: t("apiKeyCopyFailed") });
			}
		},
		[t],
	);

	const adopt = useCallback(
		async (row: PresetProviderRow, baseUrl: string | undefined = row.baseUrl): Promise<boolean> => {
			const key = (draftKeys[row.id] ?? row.defaultApiKey ?? "").trim();
			if (!key) return false;
			return mutate(async () => {
				const fetched = row.offline ? null : await refreshModels(row.id, key, row.autoKey ? baseUrl : undefined);
				if (fetched && (fetched.error || fetched.models.length === 0)) {
					const error = fetched.error ?? { code: "empty-models" as const };
					notifyKeyRejected(row.displayName, error, t);
					setModelsErrors((prev) => withError(prev, row.id, error, t));
					return false;
				}
				if (
					!(await saveProvider(row.id, (previous) => ({
						...previous,
						source: "template",
						templateId: row.id,
						displayName: row.displayName,
						icon: row.icon,
						api: row.api,
						baseUrl,
						apiKey: key,
						models: fetched?.models ?? row.models,
						...(fetched ? { modelsSyncedAt: new Date().toISOString() } : {}),
					})))
				)
					return false;
				setModelsErrors((prev) => withError(prev, row.id, undefined, t));
				setOpenId((current) => (current === row.id ? null : current));
				setDraftKeys((prev) => {
					const next = { ...prev };
					delete next[row.id];
					return next;
				});
				return true;
			});
		},
		[draftKeys, mutate, saveProvider, t],
	);
	const toggleEnabled = useCallback(
		async (row: PresetProviderRow, next: boolean): Promise<void> => {
			if (row.adopted) {
				await mutate(() =>
					saveProvider(row.id, (previous) => (previous ? { ...previous, disabled: !next } : previous)),
				);
			} else if (next) {
				if (row.autoKey) await adopt(row);
				else handleToggleEditor(row);
			}
		},
		[adopt, handleToggleEditor, mutate, saveProvider],
	);

	const changeBaseUrl = useCallback(
		async (row: PresetProviderRow, input: string): Promise<boolean> => {
			const url = input.trim();
			if (row.id !== "magpie" || !isMagpieBaseUrl(url)) {
				showToast({ variant: "error", message: t("presetErrorInvalidBaseUrl") });
				return false;
			}
			if (!row.adopted) return adopt(row, url);
			return mutate(async () => {
				// The renderer holds a redacted key. Resolve the real credential in main.
				const fetched = await refreshModels(row.id, undefined, url);
				if (fetched.error || fetched.models.length === 0) {
					const error = fetched.error ?? { code: "empty-models" as const };
					setModelsErrors((prev) => withError(prev, row.id, error, t));
					notifyPresetError(row.displayName, error, t);
					return false;
				}
				const saved = await saveProvider(row.id, (previous) =>
					previous
						? {
								...previous,
								baseUrl: url,
								models: fetched.models,
								modelsSyncedAt: new Date().toISOString(),
							}
						: previous,
				);
				if (saved) setModelsErrors((prev) => withError(prev, row.id, undefined, t));
				return saved;
			});
		},
		[adopt, mutate, saveProvider, t],
	);

	const refresh = useCallback(
		async (row: PresetProviderRow): Promise<void> => {
			if (!row.adopted) return;
			await mutate(async () => {
				setRefreshingId(row.id);
				try {
					const result = await refreshModels(row.id);
					setModelsErrors((prev) => withError(prev, row.id, result.error, t));
					if (result.error) notifyPresetError(row.displayName, result.error, t);
					if (result.models.length === 0) return false;
					return saveProvider(row.id, (previous) =>
						previous
							? {
									...previous,
									models: result.models,
									modelsSyncedAt: new Date().toISOString(),
								}
							: previous,
					);
				} finally {
					setRefreshingId(null);
				}
			});
		},
		[mutate, saveProvider, t],
	);

	/** 手动重拉公共目录:清冷却强制重试,失败把原文打进控制台并显示出来。 */
	const refreshCatalog = useCallback(async (): Promise<void> => {
		setRefreshingCatalog(true);
		try {
			const result = await window.agent567.models.refreshPresetCatalog();
			if (result.ok) {
				console.info(
					`[preset-providers] models.dev 目录已更新，共 ${result.modelCount} 个模型（${result.elapsedMs}ms）`,
				);
				showToast({
					variant: "success",
					message: t("catalogRefreshed", { count: result.modelCount }),
				});
			} else {
				console.error("[preset-providers] 刷新 models.dev 目录失败：", result.error);
				showToast({
					variant: "error",
					title: t("catalogRefreshFailed"),
					message: translatePresetError(result.error ?? { code: "network" }, t),
					durationMs: 8000,
				});
			}
			await load();
		} catch (err) {
			console.error("[preset-providers] 刷新 models.dev 目录异常：", err);
			showToast({
				variant: "error",
				title: t("catalogRefreshFailed"),
				message: translatePresetError({ code: "network", detail: String(err) }, t),
				durationMs: 8000,
			});
		} finally {
			setRefreshingCatalog(false);
		}
	}, [load, t]);

	const remove = useCallback(
		async (row: PresetProviderRow): Promise<void> => {
			if (!(await mutate(() => saveProvider(row.id, () => undefined)))) return;
			setOpenId((current) => (current === row.id ? null : current));
			setModelsErrors((prev) => withError(prev, row.id, undefined, t));
			setDraftKeys((prev) => {
				const next = { ...prev };
				delete next[row.id];
				return next;
			});
		},
		[mutate, saveProvider, t],
	);

	return {
		rows,
		error,
		loading,
		draftKeys,
		saving,
		labels: {
			title: t("presetProviders"),
			loading: t("loading"),
			noPresetProviders: t("noPresetProviders"),
			enabled: t("enabled"),
			deprecated: t("deprecated"),
			collapseModels: t("collapseModels"),
			viewModels: t("viewModels"),
			modelsCount: (count: number) => t("modelsCount", { count }),
			collapse: t("collapse"),
			cancel: t("cancel"),
			changeKey: t("changeKey"),
			remove: t("remove"),
			enable: t("enable"),
			apiKeyDirect: (provider: string) => t("apiKeyDirect", { provider }),
			apiKeyPlaceholder: t("presetApiKeyPlaceholder"),
			encryptedApiKeyPlaceholder: t("replaceApiKeyPlaceholder"),
			save: t("save"),
			noModels: t("noModels"),
			noMatchingModels: t("noMatchingModels"),
			searchModels: (provider: string) => t("searchModels", { provider }),
			clearModelSearch: t("clearModelSearch"),
			modelListLabel: (provider: string) => t("modelListLabel", { provider }),
			thinking: t("thinking"),
			perMillionTokens: t("perMillionTokens"),
			refreshModels: t("refreshModels"),
			refreshingModels: t("refreshingModels"),
			refreshCatalog: t("refreshCatalog"),
			copyApiKey: t("copyApiKey"),
			magpiePortHint: t("magpiePortHint"),
			testConnect: t("testConnect"),
			testing: t("testing"),
			testOk: t("testOk"),
			testFailed: t("testFailed"),
			editBaseUrl: t("editBaseUrl"),
			baseUrlPlaceholder: t("baseUrlPlaceholder"),
			toggleProvider: (provider: string) => t("toggleProvider", { provider }),
		},
		onToggleExpanded: handleToggleExpanded,
		onToggleEditor: handleToggleEditor,
		onDraftKeyChange: handleDraftKeyChange,
		onAdopt: adopt,
		onToggleEnabled: toggleEnabled,
		onChangeBaseUrl: changeBaseUrl,
		onRemove: remove,
		onRefreshModels: refresh,
		onCopyApiKey: copyApiKey,
		refreshingCatalog,
		onRefreshCatalog: refreshCatalog,
	};
}

function toModelRow(
	model: NonNullable<ProviderEntry["models"]>[number],
	t: TFunction<"settings">,
): PresetProviderModelRow {
	return {
		id: model.id,
		name: model.name || model.id,
		contextWindow: model.contextWindow,
		hasVision: model.input?.includes("image") ?? false,
		hasReasoning: Boolean(model.reasoning),
		reasoningLevels: model.reasoningLevels,
		price: formatPrice(model.cost, t),
	};
}

interface BaseRow {
	id: string;
	displayName: string;
	api: string;
	baseUrl?: string;
	icon?: string;
	defaultApiKey?: string;
	models: NonNullable<ProviderEntry["models"]>;
	offline: boolean;
}

async function refreshModels(
	providerId: string,
	apiKey?: string,
	baseUrl?: string,
): Promise<{ models: NonNullable<ProviderEntry["models"]>; error?: PresetError }> {
	try {
		return await window.agent567.models.refreshPresetModels(providerId, apiKey, baseUrl);
	} catch (err) {
		return { models: [], error: { code: "network", detail: err instanceof Error ? err.message : String(err) } };
	}
}

/** 错误既进行内提示,也进全局通知——设置页可能已经滚走了,行内那行字看不见。 */
function notifyPresetError(provider: string, error: PresetError, t: TFunction<"settings">): void {
	// 密钥被拒是最常见也最需要一眼认出的失败,不能淹没在笼统的「拉取失败」标题里。
	const title = isInvalidKey(error) ? t("keyRejected", { provider }) : t("modelsRefreshFailed", { provider });
	showToast({ variant: "error", title, message: translatePresetError(error, t), durationMs: 8000 });
}

/** 启用被挡下时的提示。必须说清「没保存」,否则用户会以为已经生效。 */
function notifyKeyRejected(provider: string, error: PresetError, t: TFunction<"settings">): void {
	showToast({
		variant: "error",
		title: isInvalidKey(error) ? t("keyRejected", { provider }) : t("keyNotVerified", { provider }),
		message: `${translatePresetError(error, t)} ${t("keyRejectedHint")}`,
		durationMs: 8000,
	});
}

function withError(
	prev: Record<string, string>,
	id: string,
	error: PresetError | undefined,
	t: TFunction<"settings">,
): Record<string, string> {
	if (error) return { ...prev, [id]: translatePresetError(error, t) };
	if (!(id in prev)) return prev;
	const next = { ...prev };
	delete next[id];
	return next;
}

function formatSyncedAt(iso: string, locale: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString(locale, { dateStyle: "short", timeStyle: "short" });
}

function formatPrice(cost: ModelCost | undefined, t: (key: CostLabelKey) => string): string | null {
	if (!cost) return null;
	const num = (n: number) => (Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(6)).toString());
	const parts: string[] = [];
	if (cost.input) parts.push(`${t("costInput")} $${num(cost.input)}`);
	if (cost.cacheRead) parts.push(`${t("costCacheRead")} $${num(cost.cacheRead)}`);
	if (cost.cacheWrite) parts.push(`${t("costCacheWrite")} $${num(cost.cacheWrite)}`);
	if (cost.output) parts.push(`${t("costOutput")} $${num(cost.output)}`);
	if (parts.length === 0) return null;
	return parts.join(" · ");
}
