import {
	CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION,
	CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID,
	type CodingAgentModelCallLimitConfiguration,
} from "@567agent/coding-agent/settings";
import type { DesktopRuntimeConfigurationCatalog } from "@preload/api";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import type { ModelCallLimitSettingsModel } from "@vetta-org/theme-ui/settings";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

function readValue(catalog: DesktopRuntimeConfigurationCatalog): CodingAgentModelCallLimitConfiguration {
	const entry = catalog.entries.find(
		({ configurationId }) => configurationId === CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID,
	);
	if (!entry) throw new Error("Missing model-call limit configuration");
	return CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION.codec.decode(entry.value);
}

export function useModelCallLimitSettingsModel(): ModelCallLimitSettingsModel {
	const { t } = useTranslation("settings");
	const defaults = CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION.defaultValue;
	const [applied, setApplied] = useState<CodingAgentModelCallLimitConfiguration>();
	const [enabled, setEnabled] = useState(true);
	const [limit, setLimit] = useState(String(defaults.maxCalls));
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<"loadFailed" | "saveFailed">();
	const [saved, setSaved] = useState(false);
	const [reload, setReload] = useState(0);
	const inFlight = useRef(false);
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		let cancelled = false;
		if (reload > 0) setSaved(false);
		setLoading(true);
		setError(undefined);
		void (async () => {
			await waitForCommittedPaint();
			if (cancelled) return;
			try {
				const value = readValue(await window.agent567.runtimeConfiguration.list());
				if (cancelled) return;
				setApplied(value);
				setEnabled(value.enabled);
				setLimit(String(value.maxCalls));
				setSaved(false);
			} catch {
				if (!cancelled) setError("loadFailed");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [reload]);
	const parsed = /^\d+$/.test(limit.trim()) ? Number(limit.trim()) : NaN;
	const valid = Number.isSafeInteger(parsed) && parsed > 0;
	const invalid = enabled && !valid;
	const maxCalls = valid ? parsed : (applied?.maxCalls ?? defaults.maxCalls);
	const dirty = Boolean(applied && (enabled !== applied.enabled || maxCalls !== applied.maxCalls));
	const canSave = Boolean(applied && dirty && !invalid && !loading && !saving);
	const save = async (): Promise<void> => {
		if (!canSave || inFlight.current) return;
		inFlight.current = true;
		setSaving(true);
		setSaved(false);
		setError(undefined);
		try {
			await waitForCommittedPaint();
			if (!mounted.current) return;
			const value = readValue(
				await window.agent567.runtimeConfiguration.set(CODING_AGENT_MODEL_CALL_LIMIT_CONFIGURATION_ID, {
					enabled,
					maxCalls,
				}),
			);
			if (!mounted.current) return;
			setApplied(value);
			setSaved(true);
		} catch {
			if (mounted.current) setError("saveFailed");
		} finally {
			inFlight.current = false;
			if (mounted.current) setSaving(false);
		}
	};
	return {
		loading,
		saving,
		enabled,
		limit,
		invalid,
		canSave,
		error: error ? t(`modelCallLimit.${error}`) : undefined,
		status: loading ? t("modelCallLimit.loading") : saved ? t("modelCallLimit.saved") : undefined,
		labels: {
			title: t("modelCallLimit.title"),
			limit: t("modelCallLimit.limit"),
			description: t("modelCallLimit.description"),
			maxCalls: t("modelCallLimit.maxCalls"),
			timing: t("modelCallLimit.timing"),
			unlimited: t("modelCallLimit.unlimited"),
			invalid: t("modelCallLimit.invalid"),
			save: t("modelCallLimit.save"),
			saving: t("modelCallLimit.saving"),
			reset: t("modelCallLimit.reset"),
			retry: t("modelCallLimit.retry"),
		},
		actions: {
			setEnabled: (value) => {
				setEnabled(value);
				setSaved(false);
			},
			setLimit: (value) => {
				setLimit(value);
				setSaved(false);
			},
			save: () => {
				void save();
			},
			reset: () => {
				setEnabled(defaults.enabled);
				setLimit(String(defaults.maxCalls));
				setSaved(false);
				setError(undefined);
			},
			reload: () => {
				if (error === "saveFailed") void save();
				else setReload((value) => value + 1);
			},
		},
	};
}
