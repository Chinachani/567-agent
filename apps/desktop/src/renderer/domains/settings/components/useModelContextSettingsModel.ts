import { selectedModelAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import type { ModelsConfigData } from "../../../../preload/api-types/models";
import { parseContextCapacityInput, resolveModelContext } from "../../../../shared/model-context";
import { getModelContextReference } from "../../../../shared/model-context-reference";
import { isModelInferenceApi, type ModelInferenceApi } from "../../../../shared/model-inference-api";

export function useModelContextSettingsModel(config: ModelsConfigData) {
	const activeModel = useAtomValue(selectedModelAtom);
	const [current, setCurrent] = useState(config);
	const [selection, setSelection] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
	const [drafts, setDrafts] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);
	const [notice, setNotice] = useState<{
		key: string;
		kind: "saved" | "failed" | "protocolSaved" | "protocolFailed";
	} | null>(null);
	useEffect(() => setCurrent(config), [config]);
	useEffect(() => {
		let live = true;
		const dispose = window.agent567.models.onChanged(() => {
			void window.agent567.models
				.get()
				.then((value) => {
					if (live) setCurrent(value);
				})
				.catch(() => {});
		});
		return () => {
			live = false;
			dispose();
		};
	}, []);
	const options = Object.entries(current.providers).flatMap(([providerId, provider]) =>
		(provider.models ?? []).map((model) => ({
			value: JSON.stringify([providerId, model.id]),
			providerId,
			model,
			label: `${model.name ?? model.id} · ${provider.displayName ?? providerId}`,
			active: `${providerId}/${model.id}` === activeModel,
			defaultModel: `${providerId}/${model.id}` === current.defaultModel,
		})),
	);
	const selected =
		options.find((entry) => entry.value === selection) ??
		options.find((entry) => entry.active) ??
		options.find((entry) => entry.defaultModel) ??
		options[0];
	const key = selected?.value ?? "";
	useEffect(() => {
		if (key && key !== selection) setSelection(key);
	}, [key, selection]);
	const provider = selected ? current.providers[selected.providerId] : undefined;
	const apiOverride = selected ? provider?.modelOverrides?.[selected.model.id]?.api : undefined;
	const automaticApi = selected?.model.api ?? provider?.api ?? "openai-completions";
	const effectiveApi = typeof apiOverride === "string" ? apiOverride : automaticApi;
	const saveProtocol = async (api: ModelInferenceApi | null): Promise<void> => {
		if (!selected || pending.current) return;
		pending.current = true;
		setBusy(true);
		setNotice(null);
		try {
			await window.agent567.models.setInferenceApi(selected.providerId, selected.model.id, api);
			setCurrent(await window.agent567.models.get());
			setNotice({ key, kind: "protocolSaved" });
		} catch {
			setNotice({ key, kind: "protocolFailed" });
		} finally {
			pending.current = false;
			setBusy(false);
		}
	};
	const info = resolveModelContext(
		selected?.model,
		selected ? provider?.modelOverrides?.[selected.model.id] : undefined,
	);
	const automatic = resolveModelContext(selected?.model);
	const reference = selected ? getModelContextReference(selected.model.id) : undefined;
	const draft = drafts[key] ?? (info.manual === undefined ? "" : String(info.manual));
	const parsed = parseContextCapacityInput(draft);
	const valid = !draft.trim() || parsed !== undefined;
	const setDraft = (value: string): void => {
		setDrafts((previous) => ({ ...previous, [key]: value }));
		setNotice(null);
	};
	const save = async (capacity: number | null): Promise<void> => {
		if (!selected || pending.current) return;
		pending.current = true;
		setBusy(true);
		setNotice(null);
		try {
			await window.agent567.models.setContextWindow(selected.providerId, selected.model.id, capacity);
			setCurrent(await window.agent567.models.get());
			setDrafts((previous) => {
				const next = { ...previous };
				delete next[key];
				return next;
			});
			setNotice({ key, kind: "saved" });
		} catch {
			setNotice({ key, kind: "failed" });
		} finally {
			pending.current = false;
			setBusy(false);
		}
	};
	return {
		options,
		protocolSupported: isModelInferenceApi(effectiveApi),
		protocol: isModelInferenceApi(apiOverride) ? apiOverride : "auto",
		automaticApi,
		effectiveApi,
		saveProtocol,
		count: options.length,
		results:
			submittedQuery === null
				? []
				: options.filter((entry) =>
						`${entry.label} ${entry.providerId} ${entry.model.id}`
							.toLowerCase()
							.includes(submittedQuery.toLowerCase()),
					),
		submittedQuery,
		search: () => setSubmittedQuery(query.trim()),
		clearSearch: () => {
			setQuery("");
			setSubmittedQuery(null);
		},
		selected: key,
		setSelection,
		query,
		setQuery,
		info,
		automatic,
		reference,
		draft,
		setDraft,
		parsed,
		valid,
		busy,
		notice: notice?.key === key ? notice.kind : null,
		save: () => save(parsed ?? null),
		restore: () => save(null),
	};
}

export type ModelContextSettingsModel = ReturnType<typeof useModelContextSettingsModel>;
