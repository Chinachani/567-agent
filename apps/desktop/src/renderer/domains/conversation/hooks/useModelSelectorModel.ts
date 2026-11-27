import { resolveReasoning } from "@shared/components/ModelSelect/resolveReasoning";
import { type ModelOption, useModelOptions } from "@shared/components/ModelSelect/useModelOptions";
import {
	fallbackOptionFromKey,
	isValidReasoningLevel,
	useModelPickerModel,
} from "@shared/components/ModelSelect/useModelPickerModel";
import {
	activeSessionAtom,
	modelSupportsImagesAtom,
	reasoningByModelAtom,
	selectedModelAtom,
} from "@shared/store/atoms";
import type { ModelSelectorViewProps } from "@vetta-org/theme-ui/chat";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo } from "react";
import { modelOutputKind } from "../../../../shared/model-output-kind";

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
	return option.imageOnly ?? modelOutputKind(option.modelId, option) === "image-only";
}

const isChatModel = (option: ModelOption): boolean => !isImageGenerationModel(option);

/**
 * 输入栏右下角的模型 + 推理档位选择器。目录、分组、文案与视图都来自共享的
 * useModelPickerModel（和设置页、插件里的选择器同一份）；这里只负责输入栏特有的写回：
 * - 选中的模型用于当前窗口，并写进当前会话的 session settings；
 * - 推理档位按模型记忆（reasoningByModelAtom），随 prompt 发出；
 * - 所选模型是否支持图片同步给输入栏。
 * 传入 scope 时（团队成员等局部输入框）改由 scope 持有模型与档位。
 */
export function useModelSelectorModel({
	updateActiveSession = true,
	scope,
}: {
	readonly updateActiveSession?: boolean;
	readonly scope?: ModelSelectorScope;
} = {}): ModelSelectorModel {
	const [globalSelectedModel, setSelectedModel] = useAtom(selectedModelAtom);
	const [reasoningByModel, setReasoningByModel] = useAtom(reasoningByModelAtom);
	const selectedModel = scope ? scope.modelKey : globalSelectedModel;
	const activeSession = useAtomValue(activeSessionAtom);
	const setModelSupportsImages = useSetAtom(modelSupportsImagesAtom);
	const { options: allOptions, imageOnlyKeys } = useModelOptions();
	const selectedIsImageOnly =
		selectedModel !== null &&
		(imageOnlyKeys.has(selectedModel) ||
			isImageGenerationModel(
				allOptions.find((option) => option.key === selectedModel) ?? fallbackOptionFromKey(selectedModel),
			));

	const handleModelSelect = useCallback(
		(key: string | null, option: ModelOption | null) => {
			if (!key) return;
			if (scope) scope.onModelSelect(key, resolveReasoning(option)?.default);
			// 当前窗口暂用此选择；新窗口和新会话仍读取用户配置的默认模型。
			// 已有会话另写 session settings。
			setSelectedModel(key);
			if (!scope && updateActiveSession && activeSession?.runtimeId) {
				void window.agent567.session.updateSettings(activeSession.runtimeId, { modelKey: key });
			}
		},
		[setSelectedModel, activeSession, updateActiveSession, scope],
	);

	const handleReasoningSelect = useCallback(
		(value: string) => {
			if (!selectedModel) return;
			if (scope) scope.onReasoningSelect(value);
			else setReasoningByModel({ ...reasoningByModel, [selectedModel]: value });
		},
		[selectedModel, reasoningByModel, setReasoningByModel, scope],
	);

	const rememberedLevel = selectedModel ? (scope ? scope.reasoning : reasoningByModel[selectedModel]) : undefined;
	const reasoning = useMemo(
		() => ({ value: rememberedLevel, onChange: handleReasoningSelect }),
		[rememberedLevel, handleReasoningSelect],
	);

	const picker = useModelPickerModel({
		value: selectedIsImageOnly ? null : selectedModel,
		onChange: handleModelSelect,
		reasoning,
		filterModel: isChatModel,
	});
	const { options, globalDefaultKey, catalogOption, resolvedReasoning } = picker;

	// Auto-apply the configured default model when nothing is selected yet.
	useEffect(() => {
		if (selectedModel && !selectedIsImageOnly) return;
		if (!globalDefaultKey) {
			if (selectedIsImageOnly && !scope) setSelectedModel(null);
			return;
		}
		if (scope) {
			const defaultReasoning = resolveReasoning(options.find((option) => option.key === globalDefaultKey))?.default;
			scope.onModelSelect(globalDefaultKey, defaultReasoning);
		} else {
			setSelectedModel(globalDefaultKey);
		}
	}, [selectedModel, globalDefaultKey, setSelectedModel, scope, options, selectedIsImageOnly]);

	// Keep image-support flag in sync with the resolved catalog selection only.
	useEffect(() => {
		if (options.length === 0) return;
		setModelSupportsImages(catalogOption?.supportsImage ?? false);
	}, [options.length, catalogOption, setModelSupportsImages]);

	// Persist the effective default level for the selected model when none is remembered,
	// so the prompt sender always has a value to send (per-model memory seeded with default).
	useEffect(() => {
		if (scope || !selectedModel || !resolvedReasoning) return;
		const remembered = reasoningByModel[selectedModel];
		if (!remembered || !isValidReasoningLevel(remembered, resolvedReasoning)) {
			setReasoningByModel({ ...reasoningByModel, [selectedModel]: resolvedReasoning.default });
		}
	}, [selectedModel, resolvedReasoning, reasoningByModel, setReasoningByModel, scope]);

	return {
		// 已有选中 key 时即使 options 还在加载也展示触发器，避免空白/占位闪烁。
		empty: picker.empty,
		viewProps: picker.viewProps,
	};
}
