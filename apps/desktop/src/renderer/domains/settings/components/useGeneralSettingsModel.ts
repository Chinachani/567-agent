import { openSetupWizard } from "@domains/setup-wizard";
import {
	confirmDialogAtom,
	debugModeAtom,
	type SessionExecutionMode,
	sessionExecutionModeAtom,
	workspacePathAtom,
} from "@shared/store/atoms";
import { useAtom, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type GitHubUpdateSource, normalizeGitHubUpdateProxyUrl } from "../../../../shared/github-download-source.js";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

export interface GeneralSettingsModel {
	actions: {
		changeExecutionMode: (mode: string) => Promise<void>;
		resetWorkspace: () => Promise<void>;
		selectWorkspace: () => Promise<void>;
		startAppGuide: () => void;
		toggleDebug: (checked: boolean) => void;
		toggleNotifications: (checked: boolean) => void;
		setUpdateSource: (source: GitHubUpdateSource) => Promise<void>;
		saveUpdateProxyUrl: () => Promise<void>;
		setUpdateProxyUrl: (url: string) => void;
	};
	debugMode: boolean;
	executionMode: SessionExecutionMode;
	labels: GeneralSettingsLabels;
	notificationsEnabled: boolean;
	sandboxUnavailableReason: string | null;
	workspacePath: string;
	updateSource: GitHubUpdateSource;
	updateProxyUrl: string;
	updateProxyUrlValid: boolean;
	updateSourceSaveState: "idle" | "saving" | "saved" | "error";
}

interface GeneralSettingsLabels {
	appVersion: string;
	updateSource: string;
	updateSourceDescription: string;
	updateSourceOfficial: string;
	updateSourceAccelerated: string;
	updateSourceCustom: string;
	updateSourceCustomHint: string;
	updateSourceCustomPlaceholder: string;
	updateSourceSave: string;
	updateSourceSaving: string;
	updateSourceSaved: string;
	updateSourceInvalid: string;
	updateSourceSaveFailed: string;
	debugMode: string;
	debugModeDescription: string;
	export: string;
	exportDiagnostics: string;
	exportDiagnosticsDescription: string;
	exporting: string;
	fullAccess: string;
	reset: string;
	sandboxDescription: string;
	sandboxTitle: string;
	sections: {
		app: string;
		basics: string;
		developer: string;
	};
	startAppGuide: string;
	startAppGuideAction: string;
	startAppGuideDescription: string;
	systemNotifications: string;
	systemNotificationsDescription: string;
	title: string;
	useSandbox: string;
	workspaceDescription: string;
	workspaceTitle: string;
}

export function useGeneralSettingsModel(): GeneralSettingsModel {
	const { t } = useTranslation("settings");
	const [workspacePath, setWorkspacePath] = useAtom(workspacePathAtom);
	const [debugMode, setDebugMode] = useAtom(debugModeAtom);
	const [executionMode, setExecutionMode] = useAtom(sessionExecutionModeAtom);
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	const [sandboxUnavailableReason, setSandboxUnavailableReason] = useState<string | null>(null);
	const [notificationsEnabled, setNotificationsEnabled] = useState(true);
	const [updateSource, setUpdateSourceState] = useState<GitHubUpdateSource>("github");
	const [updateProxyUrl, setUpdateProxyUrlState] = useState("");
	const [updateSourceSaveState, setUpdateSourceSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

	useEffect(() => {
		void window.agent567.config.get().then((config) => {
			setNotificationsEnabled(config.notificationsEnabled !== false);
			const source =
				config.updateSource === "gh-proxy" || config.updateSource === "custom" ? config.updateSource : "github";
			setUpdateSourceState(source);
			setUpdateProxyUrlState(config.updateProxyUrl ?? "");
			const mode = config.defaultExecutionMode ?? "full-access";
			setExecutionMode(mode);
			localStorage.setItem("vetta-session-execution-mode", mode);
			const capability = config.sandbox ?? config.linuxSandbox;
			if (capability?.status === "unavailable") {
				const reason = capability.reason ?? "unknown_error";
				const platform = "platform" in capability ? capability.platform : "linux";
				setSandboxUnavailableReason(t("sandboxUnavailable", { platform, reason }));
				return;
			}
			setSandboxUnavailableReason(null);
		});
	}, [setExecutionMode, t]);

	const selectWorkspace = useCallback(async () => {
		const selected = await window.agent567.dialog.selectFolder();
		if (!selected) return;
		setWorkspacePath(selected);
		localStorage.setItem("vetta-workspace-path", selected);
		await window.agent567.config.set({ workspacePath: selected });
		recordSettingsUsage({ tab: "general", action: "selected", target: "workspace" });
	}, [setWorkspacePath]);

	const resetWorkspace = useCallback(async () => {
		const defaultPath = "~/.567agent/workspace";
		setWorkspacePath(defaultPath);
		localStorage.setItem("vetta-workspace-path", defaultPath);
		await window.agent567.config.set({ workspacePath: defaultPath });
		recordSettingsUsage({ tab: "general", action: "reset", target: "workspace" });
	}, [setWorkspacePath]);

	const toggleDebug = useCallback(
		(checked: boolean) => {
			if (!checked) {
				setConfirmDialog({
					title: t("closeDebugTitle"),
					message: t("closeDebugMessage"),
					confirmLabel: t("closeDebugConfirm"),
					variant: "danger",
					onConfirm: () => {
						void window.agent567.debug.clearDebugDir();
						setDebugMode(false);
						localStorage.setItem("vetta-debug-mode", "false");
						void window.agent567.config.set({ debugMode: false });
						recordSettingsUsage({ tab: "general", action: "disabled", target: "debug-mode" });
					},
				});
				return;
			}
			setDebugMode(true);
			localStorage.setItem("vetta-debug-mode", "true");
			void window.agent567.config.set({ debugMode: true });
			recordSettingsUsage({ tab: "general", action: "enabled", target: "debug-mode" });
		},
		[setConfirmDialog, setDebugMode, t],
	);

	const toggleNotifications = useCallback((checked: boolean) => {
		setNotificationsEnabled(checked);
		void window.agent567.config.set({ notificationsEnabled: checked });
		recordSettingsUsage({ tab: "general", action: checked ? "enabled" : "disabled", target: "notifications" });
	}, []);

	const setUpdateSource = useCallback(
		async (source: GitHubUpdateSource) => {
			if (updateSourceSaveState === "saving") return;
			const previous = updateSource;
			setUpdateSourceState(source);
			setUpdateSourceSaveState("idle");
			if (source === "custom") return;
			setUpdateSourceSaveState("saving");
			try {
				await window.agent567.config.set({ updateSource: source });
				setUpdateSourceSaveState("saved");
			} catch (error) {
				setUpdateSourceState(previous);
				setUpdateSourceSaveState("error");
				console.error("[GeneralSettings] failed to save update source:", error);
			}
		},
		[updateSource, updateSourceSaveState],
	);

	const setUpdateProxyUrl = useCallback((url: string) => {
		setUpdateProxyUrlState(url);
		setUpdateSourceSaveState("idle");
	}, []);

	const saveUpdateProxyUrl = useCallback(async () => {
		const normalized = normalizeGitHubUpdateProxyUrl(updateProxyUrl);
		if (!normalized) {
			setUpdateSourceSaveState("error");
			return;
		}
		setUpdateSourceSaveState("saving");
		try {
			await window.agent567.config.set({ updateSource: "custom", updateProxyUrl: normalized });
			setUpdateSourceState("custom");
			setUpdateProxyUrlState(normalized);
			setUpdateSourceSaveState("saved");
		} catch (error) {
			setUpdateSourceSaveState("error");
			console.error("[GeneralSettings] failed to save custom update source:", error);
		}
	}, [updateProxyUrl]);

	const changeExecutionMode = useCallback(
		async (mode: string) => {
			const nextMode = mode as SessionExecutionMode;
			if (nextMode === executionMode) return;
			if (nextMode === "sandbox" && sandboxUnavailableReason) return;
			const previousMode = executionMode;
			setExecutionMode(nextMode);
			localStorage.setItem("vetta-session-execution-mode", nextMode);
			try {
				await window.agent567.config.set({ defaultExecutionMode: nextMode });
				recordSettingsUsage({ tab: "general", action: "changed", target: "execution-mode", value: nextMode });
			} catch (error) {
				setExecutionMode(previousMode);
				localStorage.setItem("vetta-session-execution-mode", previousMode);
				console.error("[GeneralSettings] failed to switch execution mode:", error);
			}
		},
		[executionMode, sandboxUnavailableReason, setExecutionMode],
	);

	const startAppGuide = useCallback(() => {
		openSetupWizard();
		recordSettingsUsage({ tab: "general", action: "selected", target: "setup-guide" });
	}, []);

	const labels = useMemo<GeneralSettingsLabels>(
		() => ({
			debugMode: t("debugMode"),
			debugModeDescription: t("debugModeDescription"),
			export: t("export"),
			exportDiagnostics: t("diagnostics.title"),
			exportDiagnosticsDescription: t("diagnostics.entryHint"),
			exporting: t("exporting"),
			fullAccess: t("fullAccess"),
			reset: t("reset"),
			sandboxDescription: t("sandboxDescription"),
			sandboxTitle: t("sandbox.title"),
			sections: {
				app: t(SETTINGS_SECTION["general-app"].titleKey),
				basics: t(SETTINGS_SECTION["general-basics"].titleKey),
				developer: t(SETTINGS_SECTION["general-developer"].titleKey),
			},
			appVersion: t("appVersion"),
			updateSource: t("updateSource.title"),
			updateSourceDescription: t("updateSource.description"),
			updateSourceOfficial: t("updateSource.official"),
			updateSourceAccelerated: t("updateSource.accelerated"),
			updateSourceCustom: t("updateSource.custom"),
			updateSourceCustomHint: t("updateSource.customHint"),
			updateSourceCustomPlaceholder: t("updateSource.customPlaceholder"),
			updateSourceSave: t("updateSource.save"),
			updateSourceSaving: t("updateSource.saving"),
			updateSourceSaved: t("updateSource.saved"),
			updateSourceInvalid: t("updateSource.invalid"),
			updateSourceSaveFailed: t("updateSource.saveFailed"),
			startAppGuide: t("startAppGuide"),
			startAppGuideAction: t("startAppGuideAction"),
			startAppGuideDescription: t("startAppGuideDescription"),
			systemNotifications: t("systemNotifications"),
			systemNotificationsDescription: t("systemNotificationsDescription"),
			title: t("general"),
			useSandbox: t("useSandbox"),
			workspaceDescription: t("workspaceDescription"),
			workspaceTitle: t("workspace.title"),
		}),
		[t],
	);

	return {
		actions: {
			changeExecutionMode,
			resetWorkspace,
			selectWorkspace,
			startAppGuide,
			toggleDebug,
			toggleNotifications,
			setUpdateSource,
			setUpdateProxyUrl,
			saveUpdateProxyUrl,
		},
		debugMode,
		executionMode,
		labels,
		notificationsEnabled,
		sandboxUnavailableReason,
		workspacePath,
		updateSource,
		updateProxyUrl,
		updateProxyUrlValid: Boolean(normalizeGitHubUpdateProxyUrl(updateProxyUrl)),
		updateSourceSaveState,
	};
}
