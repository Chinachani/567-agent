import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { confirmDialogAtom } from "@shared/store/atoms";
import type { CustomImageProviderDraftView, CustomImageProvidersViewModel } from "@vetta-org/theme-ui/settings";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	CUSTOM_IMAGE_PROVIDER_LIMIT,
	type CustomImageProviderSummary,
} from "../../../../shared/custom-image-providers";

interface Editor {
	id?: string;
	original?: CustomImageProviderSummary;
	initial: CustomImageProviderDraftView;
	draft: CustomImageProviderDraftView;
}
const emptyDraft = (): CustomImageProviderDraftView => ({
	name: "",
	baseUrl: "",
	model: "",
	apiKey: "",
	supportsTextToImage: true,
	supportsImageToImage: true,
});

export function useCustomImageProvidersModel(onChanged: () => Promise<void>): CustomImageProvidersViewModel {
	const { t } = useTranslation("settings");
	const confirm = useSetAtom(confirmDialogAtom);
	const [providers, setProviders] = useState<CustomImageProviderSummary[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string>();
	const [formError, setFormError] = useState<string>();
	const [editor, setEditor] = useState<Editor | null>(null);
	const alive = useRef(true);
	const inFlight = useRef(false);
	const revision = useRef(0);
	const returnFocus = useRef<HTMLElement | null>(null);
	const reload = useCallback(async () => {
		const version = ++revision.current;
		setLoading(true);
		await waitForCommittedPaint();
		if (!alive.current || version !== revision.current) return;
		try {
			const result = await window.agent567.media.customImageProviders.list();
			if (!alive.current || version !== revision.current) return;
			if (result.ok) {
				setProviders(result.value);
				setError(undefined);
			} else setError(t(`agentSettings.imageGeneration.custom.errors.${result.error}`));
		} catch {
			if (alive.current && version === revision.current)
				setError(t("agentSettings.imageGeneration.custom.errors.store-unavailable"));
		} finally {
			if (alive.current && version === revision.current) setLoading(false);
		}
	}, [t]);
	useEffect(() => {
		alive.current = true;
		void reload();
		return () => {
			alive.current = false;
			revision.current++;
		};
	}, [reload]);
	const start = (provider?: CustomImageProviderSummary) => {
		if (inFlight.current || editor) return;
		returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const draft = provider
			? {
					name: provider.name,
					baseUrl: provider.baseUrl,
					model: provider.model,
					apiKey: "",
					supportsTextToImage: provider.supportsTextToImage,
					supportsImageToImage: provider.supportsImageToImage,
				}
			: emptyDraft();
		setFormError(undefined);
		setEditor({ id: provider?.id, original: provider, initial: draft, draft });
	};
	const close = () => {
		if (inFlight.current || confirming || !editor) return;
		if (JSON.stringify(editor.initial) === JSON.stringify(editor.draft)) {
			setEditor(null);
			return;
		}
		setConfirming(true);
		confirm({
			title: t("agentSettings.imageGeneration.custom.discardTitle"),
			message: t("agentSettings.imageGeneration.custom.discardBody"),
			confirmLabel: t("agentSettings.imageGeneration.custom.discard"),
			onCancel: () => {
				if (alive.current) setConfirming(false);
			},
			onConfirm: () => {
				if (alive.current) {
					setConfirming(false);
					setEditor(null);
				}
			},
		});
	};
	const save = async () => {
		if (!editor || inFlight.current) return;
		inFlight.current = true;
		setBusy(true);
		setFormError(undefined);
		try {
			await waitForCommittedPaint();
			if (!alive.current) return;
			const result = await window.agent567.media.customImageProviders.save({
				...editor.draft,
				...(editor.id ? { id: editor.id } : {}),
			});
			if (!alive.current) return;
			if (!result.ok) {
				setFormError(t(`agentSettings.imageGeneration.custom.errors.${result.error}`));
				return;
			}
			setEditor(null);
			await reload();
			await onChanged();
		} catch {
			if (alive.current) setFormError(t("agentSettings.imageGeneration.custom.errors.store-unavailable"));
		} finally {
			inFlight.current = false;
			if (alive.current) setBusy(false);
		}
	};
	const remove = (id: string) => {
		const provider = providers.find((p) => p.id === id);
		if (!provider || inFlight.current) return;
		confirm({
			title: t("agentSettings.imageGeneration.custom.removeTitle"),
			message: t("agentSettings.imageGeneration.custom.removeBody", { name: provider.name }),
			variant: "danger",
			confirmLabel: t("agentSettings.imageGeneration.custom.remove"),
			onConfirm: () => {
				void (async () => {
					if (!alive.current || inFlight.current) return;
					inFlight.current = true;
					setBusy(true);
					setError(undefined);
					try {
						await waitForCommittedPaint();
						if (!alive.current) return;
						const result = await window.agent567.media.customImageProviders.remove(id);
						if (!alive.current) return;
						if (!result.ok) setError(t(`agentSettings.imageGeneration.custom.errors.${result.error}`));
						else {
							await reload();
							await onChanged();
						}
					} catch {
						if (alive.current) setError(t("agentSettings.imageGeneration.custom.errors.store-unavailable"));
					} finally {
						inFlight.current = false;
						if (alive.current) setBusy(false);
					}
				})();
			},
		});
	};
	let originChanged = false;
	if (editor?.original) {
		try {
			originChanged = new URL(editor.original.baseUrl).origin !== new URL(editor.draft.baseUrl).origin;
		} catch {
			/* Incomplete URL is validated on submit. */
		}
	}
	const keys = [
		"title",
		"description",
		"add",
		"edit",
		"remove",
		"empty",
		"loading",
		"retry",
		"limit",
		"addTitle",
		"editTitle",
		"name",
		"baseUrl",
		"model",
		"apiKey",
		"storedKey",
		"textToImage",
		"imageToImage",
		"security",
		"originChanged",
		"cancel",
		"save",
		"saving",
		"namePlaceholder",
		"missingKey",
	] as const;
	const labels = Object.fromEntries(
		keys.map((key) => [key, t(`agentSettings.imageGeneration.custom.${key}`)]),
	) as CustomImageProvidersViewModel["labels"];
	return {
		providers,
		limit: CUSTOM_IMAGE_PROVIDER_LIMIT,
		loading,
		busy,
		confirming,
		error,
		formError,
		draft: editor?.draft ?? null,
		editing: Boolean(editor?.id),
		hasStoredKey: Boolean(editor?.original?.hasApiKey),
		originChanged,
		labels,
		actions: {
			add: () => start(),
			edit: (id) => start(providers.find((p) => p.id === id)),
			remove,
			reload: () => void reload(),
			close,
			save: () => void save(),
			change: (key, value) => {
				setFormError(undefined);
				setEditor((previous) => (previous ? { ...previous, draft: { ...previous.draft, [key]: value } } : null));
			},
			restoreFocus: () => returnFocus.current?.isConnected && returnFocus.current.focus(),
		},
	};
}
