import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { updaterStateAtom } from "@shared/store/atoms";
import { UpdateReleaseHistoryView } from "@vetta-org/theme-ui/overlays";
import { UpdatePreferencesView } from "@vetta-org/theme-ui/settings";
import { useAtomValue } from "jotai";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	UPDATE_CHECK_INTERVALS,
	type UpdateReleaseHistory,
	type UpdaterPreferences,
} from "../../../../shared/updater-preferences";

const RELEASES_PAGE = "https://github.com/Chinachani/567-agent/releases";
function compareVersions(left: string, right: string): number {
	const a = left.replace(/^v/, "").split(".").map(Number);
	const b = right.replace(/^v/, "").split(".").map(Number);
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return (a[index] ?? 0) - (b[index] ?? 0);
	}
	return 0;
}

/** Host connector owns IPC and lifetime; both Views only render explicit data and actions. */
export function UpdatePreferencesSettings(): JSX.Element {
	const { t } = useTranslation("settings");
	const updater = useAtomValue(updaterStateAtom);
	const [preferences, setPreferences] = useState<UpdaterPreferences | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [revision, setRevision] = useState(0);
	const saving = useRef(false);
	const [open, setOpen] = useState(false);
	const [range, setRange] = useState("since");
	const [history, setHistory] = useState<UpdateReleaseHistory | null>(null);
	const [loading, setLoading] = useState(false);
	const [historyError, setHistoryError] = useState("");
	const [historyRevision, setHistoryRevision] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setBusy(true);
		setError("");
		void window.agent567.updater
			.getPreferences()
			.then((value) => {
				if (!cancelled) setPreferences(value);
			})
			.catch(() => {
				if (!cancelled) setError(t("updateSettings.loadFailed"));
			})
			.finally(() => {
				if (!cancelled) setBusy(false);
			});
		return () => {
			cancelled = true;
		};
	}, [revision, t]);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		setHistoryError("");
		void waitForCommittedPaint().then(async () => {
			if (cancelled) return;
			try {
				const value = await window.agent567.updater.getReleaseHistory();
				if (!cancelled) setHistory(value);
			} catch {
				if (!cancelled) setHistoryError(t("updateSettings.historyFailed"));
			} finally {
				if (!cancelled) setLoading(false);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [open, historyRevision, t]);

	const releases = [...(history?.releases ?? [])].sort((a, b) => compareVersions(b.version, a.version));
	const visible =
		range === "since"
			? releases.filter(
					(release) =>
						compareVersions(release.version, history?.baselineVersion ?? updater.currentVersion) > 0 ||
						release.version === updater.currentVersion,
				)
			: releases.slice(0, Number(range));
	const openUrl = (url: string) => {
		if (/^https?:\/\//i.test(url)) void window.agent567.shell.openExternal(url);
	};

	return (
		<>
			<UpdatePreferencesView
				preferences={preferences}
				busy={busy}
				error={error}
				labels={{
					notes: t("updateSettings.notes"),
					notesDescription: t("updateSettings.notesDescription"),
					open: t("updateSettings.open"),
					releasePage: t("updateSettings.releasePage"),
					automaticCheck: t("updateSettings.automaticCheck"),
					automaticCheckDescription: t("updateSettings.automaticCheckDescription"),
					interval: t("updateSettings.interval"),
					automaticDownload: t("updateSettings.automaticDownload"),
					automaticDownloadDescription: t("updateSettings.automaticDownloadDescription"),
					showReminder: t("updateSettings.showReminder"),
					showReminderDescription: t("updateSettings.showReminderDescription"),
					restart: t("updateSettings.restart"),
					restartDescription: t("updateSettings.restartDescription"),
					retry: t("updateSettings.retry"),
					loading: t("updateSettings.loading"),
				}}
				intervals={UPDATE_CHECK_INTERVALS.map((minutes) => ({
					value: String(minutes),
					label:
						minutes < 60
							? t("updateSettings.minutes", { count: minutes })
							: t("updateSettings.hours", { count: minutes / 60 }),
				}))}
				onChange={(value) => {
					if (saving.current) return;
					saving.current = true;
					setBusy(true);
					setError("");
					void window.agent567.updater
						.setPreferences(value)
						.then(setPreferences)
						.catch(() => setError(t("updateSettings.saveFailed")))
						.finally(() => {
							saving.current = false;
							setBusy(false);
						});
				}}
				onRetry={() => setRevision((value) => value + 1)}
				onOpenNotes={() => setOpen(true)}
				onOpenReleasePage={() => openUrl(RELEASES_PAGE)}
			/>
			<UpdateReleaseHistoryView
				releasePageUrl={RELEASES_PAGE}
				open={open}
				onOpenChange={setOpen}
				range={range}
				onRangeChange={setRange}
				ranges={[
					{ value: "since", label: t("updateSettings.since") },
					...[10, 20, 50, 100].map((count) => ({
						value: String(count),
						label: t("updateSettings.recent", { count }),
					})),
				]}
				loading={loading}
				error={historyError}
				releases={visible.map((release) => ({
					...release,
					status:
						compareVersions(release.version, updater.currentVersion) > 0
							? t("updateSettings.notInstalled")
							: release.version === updater.currentVersion
								? t("updateSettings.installed")
								: "",
				}))}
				labels={{
					title: t("updateSettings.notes"),
					description: t("updateSettings.historyDescription"),
					range: t("updateSettings.range"),
					loading: t("updateSettings.loading"),
					empty: t("updateSettings.empty"),
					missing: t("updateSettings.missing"),
					retry: t("updateSettings.retry"),
					releasePage: t("updateSettings.releasePage"),
				}}
				onRetry={() => setHistoryRevision((value) => value + 1)}
				onOpenUrl={openUrl}
			/>
		</>
	);
}
