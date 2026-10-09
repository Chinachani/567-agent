import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RuntimeInstallProgress } from "../../../../shared/runtime-install-progress";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

type RuntimesStatus = Awaited<ReturnType<typeof window.agent567.runtimes.getStatus>>;
export type EnvironmentRuntimeStatus = RuntimesStatus["node"];
export type EnvironmentRuntimeKind = "node" | "python";

export interface EnvironmentSettingsModel {
	actions: {
		reinstall: (kind: EnvironmentRuntimeKind) => Promise<void>;
	};
	busy: EnvironmentRuntimeKind | null;
	error: string | null;
	progress: RuntimeInstallProgress | null;
	logs: string[];
	labels: {
		description: string;
		fetch: string;
		fetchAgain: string;
		fetching: string;
		loading: string;
		notReady: string;
		npmRegistry: string;
		npmRegistryDescription: string;
		pipIndex: string;
		pipIndexDescription: string;
		platformNotSupported: string;
		ready: string;
		runtimeDescriptions: Record<EnvironmentRuntimeKind, string>;
		sections: {
			mirrors: string;
			runtime: string;
		};
		title: string;
		progress: string;
		logs: string;
	};
	status: RuntimesStatus | null;
}

export function useEnvironmentSettingsModel(): EnvironmentSettingsModel {
	const { t } = useTranslation("settings");
	const [status, setStatus] = useState<RuntimesStatus | null>(null);
	const [busy, setBusy] = useState<EnvironmentRuntimeKind | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState<RuntimeInstallProgress | null>(null);
	const [logs, setLogs] = useState<string[]>([]);

	const refresh = useCallback(async () => {
		try {
			const next = await window.agent567.runtimes.getStatus();
			setStatus(next);
			return next;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			return null;
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(
		() =>
			window.agent567.runtimes.onProgress((next) => {
				setProgress(next);
				setLogs((previous) => [
					...previous.slice(-19),
					`${new Date(next.updatedAt).toLocaleTimeString()} · ${next.message}`,
				]);
			}),
		[],
	);

	const reinstall = useCallback(
		async (kind: EnvironmentRuntimeKind) => {
			setBusy(kind);
			setError(null);
			setProgress(null);
			setLogs([]);
			try {
				const next = await window.agent567.runtimes.reinstall(kind);
				if (!next.ready) throw new Error(t("environmentRuntimeHealthCheckFailed"));
				const refreshed = await refresh();
				if (!refreshed?.[kind].ready) throw new Error(t("environmentRuntimeHealthCheckFailed"));
				recordSettingsUsage({ tab: "environment", action: "reinstalled", target: "runtime", value: kind });
			} catch (err) {
				setError(t("environmentReinstallFailed", { detail: err instanceof Error ? err.message : String(err) }));
			} finally {
				setBusy(null);
			}
		},
		[refresh, t],
	);

	const labels = useMemo<EnvironmentSettingsModel["labels"]>(
		() => ({
			description: t("environmentDescription"),
			fetch: t("fetch"),
			fetchAgain: t("fetchAgain"),
			fetching: t("fetching"),
			loading: t("loading"),
			notReady: t("notReady"),
			npmRegistry: t("npmRegistry"),
			npmRegistryDescription: t("npmRegistryDesc"),
			pipIndex: t("pipIndex"),
			pipIndexDescription: t("pipIndexDesc"),
			platformNotSupported: t("platformNotSupported"),
			ready: t("ready"),
			runtimeDescriptions: {
				node: t("environmentNodeDesc"),
				python: t("environmentPythonDesc"),
			},
			sections: {
				mirrors: t(SETTINGS_SECTION["environment-mirrors"].titleKey),
				runtime: t(SETTINGS_SECTION["environment-runtime"].titleKey),
			},
			title: t("environment"),
			progress: t("environmentInstallProgress"),
			logs: t("environmentInstallLogs"),
		}),
		[t],
	);

	return {
		actions: { reinstall },
		busy,
		error,
		progress,
		logs,
		labels,
		status,
	};
}
