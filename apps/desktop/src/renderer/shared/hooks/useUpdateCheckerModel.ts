import type { UpdateCheckerViewProps } from "@vetta-org/theme-ui/overlays";
import { useAtomValue, useSetAtom } from "jotai";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { filePreviewAtom } from "../store/file-preview-atoms";
import { updaterRestartDialogOpenAtom, updaterStateAtom } from "../store/updater-atoms";

export function useUpdateCheckerModel(): UpdateCheckerViewProps {
	const { t } = useTranslation("settings");
	const state = useAtomValue(updaterStateAtom);
	const openRestartDialog = useSetAtom(updaterRestartDialogOpenAtom);
	const setFilePreview = useSetAtom(filePreviewAtom);
	const [busy, setBusy] = useState(false);

	const checking = busy || state.phase === "checking";

	const statusText = (() => {
		if (state.phase === "checking") return t("updaterChecking");
		if (state.phase === "available" && state.paused) return t("updateSettings.downloadPaused");
		if (state.phase === "error") return state.error ?? "";
		if (state.phase === "idle")
			return t(state.latestVersion ? "updateSettings.latestInstalled" : "updateSettings.checkHint");
		if (state.phase === "downloading") {
			const description = t("updateSettings.downloadingVersion", {
				version: state.latestVersion,
				progress: Math.round((state.progress ?? 0) * 100),
			});
			const size =
				typeof state.downloadedBytes === "number" && typeof state.totalBytes === "number" && state.totalBytes > 0
					? description +
						" · " +
						t("updateSettings.transferred", {
							downloaded: (state.downloadedBytes / 1_000_000).toFixed(1),
							total: (state.totalBytes / 1_000_000).toFixed(1),
						})
					: description;
			return state.bytesPerSecond && state.bytesPerSecond > 0
				? `${size} · ${t("updateSettings.downloadSpeed", { speed: (state.bytesPerSecond / 1_000_000).toFixed(1) })}`
				: size;
		}
		if (state.phase === "available") return t("updaterNewVersion", { version: state.latestVersion });
		if (state.phase === "ready") return t("updateSettings.ready", { version: state.latestVersion });
		if (state.phase === "installing") return t("updateSettings.installing");
		return "";
	})();

	return useMemo(
		() => ({
			checking,
			currentVersion: state.currentVersion,
			labels: {
				version: t("updateSettings.version"),
				check: t("updaterCheck"),
				transferred: (downloaded, total) => t("updateSettings.transferred", { downloaded, total }),
				checking: t("updaterChecking"),
				checkingBtn: t("updaterCheckingBtn"),
				currentVersion: (version) => t("updaterCurrentVersion", { version }),
				download: state.paused ? t("updateSettings.resumeDownload") : t("updaterDownload"),
				pause: t("updateSettings.pauseDownload"),
				downloading: (progress) => t("updaterDownloading", { progress }),
				idle: (version) => t("updaterIdle", { version }),
				newVersion: (version) => t("updaterNewVersion", { version }),
				restart: t("updaterRestart"),
				viewMore: t("updaterViewMore"),
			},
			latestVersion: state.latestVersion,
			onCheck: () => {
				setBusy(true);
				void window.agent567.updater.check().finally(() => setBusy(false));
			},
			onPrimary: () => {
				if (state.phase === "available") {
					void window.agent567.updater.download();
					return;
				}
				if (state.phase === "ready") {
					openRestartDialog(true);
				}
			},
			onPause: () => {
				void window.agent567.updater.pause();
			},
			onViewMore: () => {
				if (!state.releaseNote) return;
				const blob = new Blob([state.releaseNote], { type: "text/markdown" });
				const url = URL.createObjectURL(blob);
				const versionName = state.latestVersion ? `v${state.latestVersion}` : "update";
				setFilePreview({
					name: `${versionName}_changelog.md`,
					url,
				});
			},
			phase: state.phase,
			progress: state.progress,
			downloadedBytes: state.downloadedBytes,
			totalBytes: state.totalBytes,
			releaseNote: state.releaseNote,
			statusText,
		}),
		[checking, openRestartDialog, setFilePreview, state, statusText, t],
	);
}
