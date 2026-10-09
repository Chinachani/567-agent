import { resolveReasoning } from "@shared/components/ModelSelect/resolveReasoning";
import { type ModelOption, useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import {
	activeSessionAtom,
	modelSupportsImagesAtom,
	reasoningByModelAtom,
	selectedModelAtom,
} from "@shared/store/atoms";
import { modelCatalog } from "@shared/store/model-catalog";
import type { ModelSelectorViewProps } from "@vetta-org/theme-ui/chat";
import { fmtMultiplier } from "@vetta-org/theme-ui/shared";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";

export interface ModelSelectorModel {
	empty: boolean;
	viewProps: ModelSelectorViewProps;
}

export interface ModelSelectorScope {
	readonly modelKey: string | null;
	readonly reasoning?: string;
	readonly onModelSelect: (modelKey: string, defaultReasoning?: string) => void;
	readonly onReasoningSelect: (reasoning: string) => void;
}

export function isImageGenerationModel(option: ModelOption): boolean {
	const tags = option.tags?.map((tag) => tag.toLowerCase()) ?? [];
	if (tags.some((tag) => tag === "image-generation" || tag === "image-gen" || tag === "image-generation-only")) {
		return true;
	}
	return /(?:^|[-/])(?:gpt-)?image(?:[-/]|$)|(?:^|[-/])imagen(?:[-/]|$)/i.test(option.modelId);
}

/** options 尚未加载（如远程 catalog）时，用 modelKey 拼一个最小 option 供触发器展示。 */
function fallbackOptionFromKey(key: string): ModelOption {
	const slash = key.indexOf("/");
	const provider = slash > 0 ? key.slice(0, slash) : key;
	const modelId = slash > 0 ? key.slice(slash + 1) : key;
	return {
		provider,
		modelId,
		displayName: modelId,
		key,
	};
}

/**
 * Combined chat model + reasoning-level picker. The primary menu is the model list;
 * a "推理档位" entry at the top opens a hover submenu on the right to pick the level
 * (including "off" to disable thinking). Reasoning is per-model: each model remembers
 * its last-chosen level (reasoningByModelAtom) and the value rides the prompt.
 */
export function useModelSelectorModel({
	updateActiveSession = true,
	scope,
}: {
	readonly updateActiveSession?: boolean;
	readonly scope?: ModelSelectorScope;
} = {}): ModelSelectorModel {
	const { t } = useTranslation("common");
	const [globalSelectedModel, setSelectedModel] = useAtom(selectedModelAtom);
	const [reasoningByModel, setReasoningByModel] = useAtom(reasoningByModelAtom);
	const selectedModel = scope ? scope.modelKey : globalSelectedModel;
	const activeSession = useAtomValue(activeSessionAtom);
	const setModelSupportsImages = useSetAtom(modelSupportsImagesAtom);
	const { options, defaultKey, iconFor, labelFor } = useModelOptions();
	const chatOptions = useMemo(() => options.filter((option) => !isImageGenerationModel(option)), [options]);
	const chatGrouped = useMemo(() => {
		const groups = new Map<string, ModelOption[]>();
		for (const option of chatOptions) {
			const models = groups.get(option.provider) ?? [];
			models.push(option);
			groups.set(option.provider, models);
		}
		return groups;
	}, [chatOptions]);
	const chatDefaultKey = chatOptions.some((option) => option.key === defaultKey) ? defaultKey : chatOptions[0]?.key;

	const catalogOption = useMemo(
		() => chatOptions.find((m) => m.key === selectedModel) ?? null,
		[chatOptions, selectedModel],
	);
	// 有 key 但 catalog 未就绪时仍展示 modelId，避免闪「选择模型」。
	const selectedOption = useMemo(() => {
		if (catalogOption) return catalogOption;
		if (selectedModel) return fallbackOptionFromKey(selectedModel);
		return null;
	}, [catalogOption, selectedModel]);
	// 推理档位只认 catalog 中的真实配置，fallback option 不参与 resolve。
	const resolved = useMemo(() => resolveReasoning(catalogOption), [catalogOption]);

	// "off" (disable thinking) is always offered for reasoning-capable models, on top of
	// the model's configured/preset levels. When the model explicitly includes "none",
	// it replaces "off" so they never appear together in the dropdown.
	const menuLevels = useMemo(() => {
		if (!resolved) return [];
		if (resolved.levels.includes("none")) {
			return ["none", ...resolved.levels.filter((l) => l !== "none" && l !== "off")];
		}
		return ["off", ...resolved.levels.filter((l) => l !== "off")];
	}, [resolved]);
	const isValidLevel = useCallback(
		(v: string) => v === "off" || v === "none" || (resolved?.levels.includes(v) ?? false),
		[resolved],
	);

	const currentLevel = useMemo(() => {
		if (!selectedModel || !resolved) return undefined;
		const remembered = scope ? scope.reasoning : reasoningByModel[selectedModel];
		return remembered && isValidLevel(remembered) ? remembered : resolved.default;
	}, [selectedModel, resolved, reasoningByModel, isValidLevel, scope]);

	const levelLabel = useCallback(
		(value: string) => t(`modelSelect.reasoningLevel.${value}`, { defaultValue: value }),
		[t],
	);

	// Auto-apply the configured default model when nothing is selected yet.
	useEffect(() => {
		const selectedIsImageOnly =
			selectedModel !== null &&
			options.some((option) => option.key === selectedModel && isImageGenerationModel(option));
		if ((!selectedModel || selectedIsImageOnly) && chatDefaultKey) {
			if (scope) {
				const defaultReasoning = resolveReasoning(
					chatOptions.find((option) => option.key === chatDefaultKey),
				)?.default;
				scope.onModelSelect(chatDefaultKey, defaultReasoning);
			} else {
				setSelectedModel(chatDefaultKey);
			}
		}
	}, [selectedModel, chatDefaultKey, setSelectedModel, scope, chatOptions, options]);

	// Keep image-support flag in sync with the resolved catalog selection only.
	useEffect(() => {
		if (chatOptions.length === 0) return;
		setModelSupportsImages(catalogOption?.supportsImage ?? false);
	}, [chatOptions.length, catalogOption, setModelSupportsImages]);

	// Persist the effective default level for the selected model when none is remembered,
	// so the prompt sender always has a value to send (per-model memory seeded with default).
	useEffect(() => {
		if (scope || !selectedModel || !resolved) return;
		const remembered = reasoningByModel[selectedModel];
		if (!remembered || !isValidLevel(remembered)) {
			setReasoningByModel({ ...reasoningByModel, [selectedModel]: resolved.default });
		}
	}, [selectedModel, resolved, reasoningByModel, setReasoningByModel, isValidLevel, scope]);

	const handleModelSelect = useCallback(
		(key: string) => {
			if (scope) {
				const defaultReasoning = resolveReasoning(chatOptions.find((option) => option.key === key))?.default;
				scope.onModelSelect(key, defaultReasoning);
			}
			// 当前窗口的新会话暂用此选择；新窗口和新会话入口会重新读取配置默认值。
			// 已有会话另写 session settings。
			setSelectedModel(key);
			if (!scope && updateActiveSession && activeSession?.runtimeId) {
				void window.agent567.session.updateSettings(activeSession.runtimeId, { modelKey: key });
			}
		},
		[setSelectedModel, activeSession, updateActiveSession, scope, chatOptions],
	);

	/**
	 * 计费倍率标的文案。视图只负责渲染，倍率口径与「免费」措辞留在宿主——
	 * 插件复用同一个视图时不会连带继承宿主的计费文案。
	 */
	const multiplierLabelFor = useCallback(
		(option: { key: string }): string | undefined => {
			const multiplier = chatOptions.find((candidate) => candidate.key === option.key)?.multiplier;
			if (!multiplier) return undefined;
			return multiplier.input === 0 && multiplier.output === 0
				? t("modelSelect.free")
				: t("modelSelect.multiplier", { value: fmtMultiplier(multiplier.input) });
		},
		[chatOptions, t],
	);

	// 打开模型菜单时按 TTL 后台重校验目录，服务端增删模型无需重启即可看到。
	const handleOpenChange = useCallback((open: boolean) => {
		if (open) void modelCatalog.revalidate();
	}, []);

	const handleReasoningSelect = useCallback(
		(value: string) => {
			if (!selectedModel) return;
			if (scope) scope.onReasoningSelect(value);
			else setReasoningByModel({ ...reasoningByModel, [selectedModel]: value });
		},
		[selectedModel, reasoningByModel, setReasoningByModel, scope],
	);

	return {
		// 已有选中 key 时即使 options 还在加载也展示触发器，避免空白/占位闪烁。
		empty: chatOptions.length === 0 && !selectedModel,
		viewProps: {
			currentLevel,
			defaultKey: chatDefaultKey,
			groups: [...chatGrouped.entries()].map(([provider, models]) => ({
				icon: iconFor(provider),
				label: labelFor(provider),
				models,
				provider,
			})),
			labels: {
				clearSearch: t("modelSelect.clearSearch"),
				multiplierLabel: multiplierLabelFor,
				cloudOnly: t("modelSelect.cloudOnly"),
				defaultBadge: t("modelSelect.defaultBadge"),
				levelLabel,
				modelHeader: t("modelSelect.modelHeader"),
				noResults: t("modelSelect.noResults"),
				noResultsHint: t("modelSelect.noResultsHint"),
				placeholder: t("modelSelect.placeholder"),
				reasoningHeader: t("modelSelect.reasoningHeader"),
				searchPlaceholder: t("modelSelect.searchPlaceholder"),
				visionBadge: t("modelSelect.visionBadge"),
			},
			menuLevels,
			onModelSelect: handleModelSelect,
			onOpenChange: handleOpenChange,
			onReasoningSelect: handleReasoningSelect,
			selectedModel: selectedModel ?? undefined,
			selectedOption,
		},
	};
}
