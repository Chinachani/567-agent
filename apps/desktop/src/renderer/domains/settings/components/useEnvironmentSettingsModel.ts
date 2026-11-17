import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RuntimeInstallProgress } from "../../../../shared/runtime-install-progress";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

type RuntimesStatus = Awaited<ReturnType<typeof window.agent567.runtimes.getStatus>>;
export type EnvironmentRuntimeStatus = RuntimesStatus["node"];
export type EnvironmentRuntimeKind = "node" | "python";

const GIT_DOWNLOAD_URL = "https://git-scm.com/downloads";
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface EnvironmentSettingsModel {
	actions: {
		copyGitCommand: (command: string) => Promise<void>;
		installGit: () => Promise<void>;
		openGitDownload: () => void;
		redetect: () => Promise<void>;
		reinstall: (kind: EnvironmentRuntimeKind) => Promise<void>;
	};
	busy: EnvironmentRuntimeKind | null;
	error: string | null;
	progress: RuntimeInstallProgress | null;
	logs: string[];
	git: {
		busy: "detect" | "install" | null;
		commandCopied: boolean;
		/** macOS 已调起系统安装窗口，提示用户装好后重新检测。 */
		installerLaunched: boolean;
	};
	labels: {
		description: string;
		fetch: string;
		fetchAgain: string;
		fetching: string;
		git: {
			copied: string;
			copy: string;
			description: string;
			detecting: string;
			download: string;
			installManaged: string;
			installXcode: string;
			installing: string;
			managedHint: string;
			managedSuffix: string;
			manualHint: string;
			missing: string;
			packageManagerFallback: string;
			packageManagerHint: string;
			ready: string;
			redetect: string;
			xcodeHint: string;
			xcodeLaunched: string;
		};
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
			tools: string;
		};
		title: string;
		progress: string;
		logs: string;
		restartAndRepair: string;
		repairRequiresRestart: string;
		repairRestartDescription: string;
	};
	status: RuntimesStatus | null;
}

export function useEnvironmentSettingsModel(): EnvironmentSettingsModel {
	const { t } = useTranslation("settings");
	const [status, setStatus] = useState<RuntimesStatus | null>(null);
	const operation = useRef<EnvironmentRuntimeKind | null>(null);
	const [busy, setBusy] = useState<EnvironmentRuntimeKind | null>(null);
	const [gitBusy, setGitBusy] = useState<EnvironmentSettingsModel["git"]["busy"]>(null);
	const [installerLaunched, setInstallerLaunched] = useState(false);
	const [commandCopied, setCommandCopied] = useState(false);
	const gitOperation = useRef(false);
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
			window.agent567.runtimes.onStatusChanged(() => {
				void refresh();
			}),
		[refresh],
	);

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
			if (operation.current !== null) return;
			operation.current = kind;
			setBusy(kind);
			setError(null);
			setProgress(null);
			setLogs([]);
			let restarting = false;
			try {
				if (status?.[kind].repairRequiresRestart) {
					await window.agent567.runtimes.restartAndRepair(kind);
					restarting = true;
					return;
				}
				const next = await window.agent567.runtimes.reinstall(kind);
				if (!next.ready) throw new Error(t("environmentRuntimeHealthCheckFailed"));
				const refreshed = await refresh();
				if (!refreshed?.[kind].ready) throw new Error(t("environmentRuntimeHealthCheckFailed"));
				recordSettingsUsage({ tab: "environment", action: "reinstalled", target: "runtime", value: kind });
			} catch (err) {
				setError(t("environmentReinstallFailed", { detail: err instanceof Error ? err.message : String(err) }));
			} finally {
				if (!restarting) {
					await refresh();
					operation.current = null;
					setBusy(null);
				}
			}
		},
		[refresh, status, t],
	);

	const installGit = useCallback(async () => {
		if (gitOperation.current) return;
		gitOperation.current = true;
		const guide = status?.git.install.kind;
		setGitBusy("install");
		setError(null);
		try {
			const git = await window.agent567.runtimes.installGit();
			setStatus((prev) => (prev ? { ...prev, git } : prev));
			if (guide === "xcode-clt") setInstallerLaunched(true);
			recordSettingsUsage({ tab: "environment", action: "added", target: "git", value: guide ?? "unknown" });
		} catch (err) {
			setError(messageOf(err));
		} finally {
			gitOperation.current = false;
			setGitBusy(null);
		}
	}, [status]);

	const redetect = useCallback(async () => {
		if (gitOperation.current) return;
		gitOperation.current = true;
		setGitBusy("detect");
		setError(null);
		try {
			setStatus(await window.agent567.runtimes.redetect());
		} catch (err) {
			setError(messageOf(err));
		} finally {
			gitOperation.current = false;
			setGitBusy(null);
		}
	}, []);

	const copyGitCommand = useCallback(async (command: string) => {
		try {
			await navigator.clipboard.writeText(command);
			setCommandCopied(true);
		} catch (err) {
			setError(messageOf(err));
		}
	}, []);

	const openGitDownload = useCallback(() => {
		void window.agent567.shell.openExternal(GIT_DOWNLOAD_URL).catch((err: unknown) => setError(messageOf(err)));
	}, []);

	const labels = useMemo<EnvironmentSettingsModel["labels"]>(
		() => ({
			description: t("environmentDescription"),
			fetch: t("fetch"),
			fetchAgain: t("fetchAgain"),
			fetching: t("fetching"),
			git: {
				copied: t("environmentGit.copied"),
				copy: t("environmentGit.copy"),
				description: t("environmentGit.description"),
				detecting: t("environmentGit.detecting"),
				download: t("environmentGit.download"),
				installManaged: t("environmentGit.installManaged"),
				installXcode: t("environmentGit.installXcode"),
				installing: t("environmentGit.installing"),
				managedHint: t("environmentGit.managedHint"),
				managedSuffix: t("environmentGit.managedSuffix"),
				manualHint: t("environmentGit.manualHint"),
				missing: t("environmentGit.missing"),
				packageManagerFallback: t("environmentGit.packageManagerFallback"),
				packageManagerHint: t("environmentGit.packageManagerHint"),
				ready: t("ready"),
				redetect: t("environmentGit.redetect"),
				xcodeHint: t("environmentGit.xcodeHint"),
				xcodeLaunched: t("environmentGit.xcodeLaunched"),
			},
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
				tools: t(SETTINGS_SECTION["environment-tools"].titleKey),
			},
			title: t("environment"),
			progress: t("environmentInstallProgress"),
			logs: t("environmentInstallLogs"),
			restartAndRepair: t("environmentRestartAndRepair"),
			repairRequiresRestart: t("environmentRepairRequiresRestart"),
			repairRestartDescription: t("environmentRepairRestartDescription"),
		}),
		[t],
	);

	return {
		actions: { copyGitCommand, installGit, openGitDownload, redetect, reinstall },
		git: { busy: gitBusy, commandCopied, installerLaunched },
		busy,
		error,
		progress,
		logs,
		labels,
		status,
	};
}
