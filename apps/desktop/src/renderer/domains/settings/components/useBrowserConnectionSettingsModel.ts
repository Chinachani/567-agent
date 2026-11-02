import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import type { BrowserConnectionSettingsModel } from "@vetta-org/theme-ui/settings";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	BROWSER_TARGET_IDS,
	type BrowserLaunchTarget,
	type BrowserTargetId,
	type BrowserTargets,
	isBrowserTargetId,
} from "../../../../shared/current-browser-connection";
import {
	BROWSER_EXTENSION_GUIDE_URL,
	BROWSER_EXTENSION_URL,
	readCurrentBrowserConnection,
	updateCurrentBrowserConnection,
} from "../mcp/current-browser-connection";

type ConnectionError =
	| "conflict"
	| "loadFailed"
	| "saveFailed"
	| "openFailed"
	| "copyFailed"
	| "detectFailed"
	| "targetUnavailable"
	| "bundleFailed"
	| "copyDirectoryFailed";
type TargetChoice = BrowserTargetId | "custom" | "";
const BROWSER_NAMES = { chrome: "Google Chrome", msedge: "Microsoft Edge", chromium: "Chromium" } as const;

export function useBrowserConnectionSettingsModel(): BrowserConnectionSettingsModel {
	const { t } = useTranslation("settings");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [enabled, setEnabled] = useState(false);
	const [conflict, setConflict] = useState(false);
	const [token, setToken] = useState("");
	const [profile, setProfile] = useState("");
	const [target, setTarget] = useState<TargetChoice>("");
	const [savedTarget, setSavedTarget] = useState<TargetChoice>("");
	const [targets, setTargets] = useState<BrowserTargets>({
		defaultBrowser: null,
		defaultApplication: "",
		available: [],
	});
	const [feedback, setFeedback] = useState<string>();
	const [error, setError] = useState<ConnectionError>();
	const [copiedStoreLink, setCopiedStoreLink] = useState(false);
	const [copiedDirectory, setCopiedDirectory] = useState(false);
	const [extensionDirectory, setExtensionDirectory] = useState<string>();
	const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const copyRevision = useRef(0);
	const [reload, setReload] = useState(0);
	const mounted = useRef(false);
	const inFlight = useRef(false);

	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			copyRevision.current += 1;
			if (copyTimer.current !== null) clearTimeout(copyTimer.current);
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		if (reload > 0) setFeedback(undefined);
		setLoading(true);
		setError(undefined);
		void (async () => {
			await waitForCommittedPaint();
			if (cancelled) return;
			try {
				const [configResult, targetsResult] = await Promise.allSettled([
					window.agent567.mcp.get(),
					window.agent567.settings.getBrowserTargets(),
				]);
				if (cancelled) return;
				if (configResult.status === "rejected") throw configResult.reason;
				const state = readCurrentBrowserConnection(configResult.value);
				const detected = targetsResult.status === "fulfilled" ? targetsResult.value : null;
				if (detected) setTargets(detected);
				else setError("detectFailed");
				setSavedTarget(state.browser ?? "");
				setTarget(state.browser ?? detected?.defaultBrowser ?? "");
				setEnabled(state.enabled);
				setToken(state.token);
				setProfile(state.profile);
				setConflict(state.conflict);
				if (state.conflict) setError("conflict");
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

	const updateConnection = async (
		intent: "configure" | "disable" | "install" | "store" | "bundled",
	): Promise<void> => {
		const nextEnabled = intent !== "disable";
		if (inFlight.current || loading || conflict) return;
		if (nextEnabled && !target) return;
		if ((intent === "install" || intent === "store" || intent === "bundled") && !isBrowserTargetId(target)) return;
		inFlight.current = true;
		setSaving(true);
		setError(undefined);
		setFeedback(undefined);
		try {
			await waitForCommittedPaint();
			if (!mounted.current) return;
			const latest = await window.agent567.mcp.get();
			if (!mounted.current) return;
			if (readCurrentBrowserConnection(latest).conflict) {
				setConflict(true);
				setError("conflict");
				return;
			}
			let browser: BrowserLaunchTarget | undefined;
			if (
				isBrowserTargetId(target) &&
				(intent === "install" ||
					intent === "store" ||
					intent === "bundled" ||
					(nextEnabled && target !== savedTarget))
			) {
				try {
					const prepared = await window.agent567.settings.prepareBrowserTarget(
						target,
						intent === "bundled" ? "bundled" : intent === "install" || intent === "store" ? "store" : "resolve",
					);
					browser = {
						id: prepared.id,
						...(prepared.executablePath ? { executablePath: prepared.executablePath } : {}),
					};
					if (mounted.current && prepared.extensionDirectory) setExtensionDirectory(prepared.extensionDirectory);
				} catch (cause) {
					if (mounted.current)
						setError(
							cause instanceof Error && cause.message.includes("browser_extension_prepare_failed")
								? "bundleFailed"
								: "targetUnavailable",
						);
					return;
				}
				if (!mounted.current) return;
			}
			if (intent === "store") return;
			// Re-read after opening the browser: another settings surface may have saved meanwhile.
			const current = browser ? await window.agent567.mcp.get() : latest;
			if (!mounted.current) return;
			if (readCurrentBrowserConnection(current).conflict) {
				setConflict(true);
				setError("conflict");
				return;
			}
			const next = updateCurrentBrowserConnection(current, {
				enabled: nextEnabled,
				token,
				profile,
				browser,
				displayName: t("browserConnection.title"),
				description: t("browserConnection.description"),
			});
			await window.agent567.mcp.set(next);
			if (!mounted.current) return;
			setEnabled(nextEnabled);
			if (browser) setSavedTarget(target);
			setFeedback(
				t(
					intent === "bundled"
						? "browserConnection.bundlePrepared"
						: intent === "install"
							? "browserConnection.installPrepared"
							: nextEnabled
								? "browserConnection.saved"
								: "browserConnection.disabled",
				),
			);
		} catch {
			if (mounted.current) setError("saveFailed");
		} finally {
			inFlight.current = false;
			if (mounted.current) setSaving(false);
		}
	};
	const openExternal = async (url: string): Promise<void> => {
		setError((current) => (current === "openFailed" ? undefined : current));
		try {
			await window.agent567.auth.openExternal(url);
		} catch {
			if (mounted.current) setError("openFailed");
		}
	};
	const copyText = async (kind: "link" | "directory"): Promise<void> => {
		const text = kind === "link" ? BROWSER_EXTENSION_URL : extensionDirectory;
		if (!text) return;
		const revision = ++copyRevision.current;
		if (copyTimer.current !== null) clearTimeout(copyTimer.current);
		setCopiedStoreLink(false);
		setCopiedDirectory(false);
		const failure = kind === "link" ? "copyFailed" : "copyDirectoryFailed";
		setError((current) => (current === failure ? undefined : current));
		try {
			await navigator.clipboard.writeText(text);
			if (!mounted.current || revision !== copyRevision.current) return;
			if (kind === "link") setCopiedStoreLink(true);
			else setCopiedDirectory(true);
			copyTimer.current = setTimeout(() => {
				setCopiedStoreLink(false);
				setCopiedDirectory(false);
				copyTimer.current = null;
			}, 1500);
		} catch {
			if (mounted.current && revision === copyRevision.current) setError(failure);
		}
	};
	return {
		preferBundledInstall: target === "msedge",
		extensionDirectory,
		copiedDirectory,
		target,
		targetOptions: [
			...BROWSER_TARGET_IDS.map((id) => ({ value: id, label: BROWSER_NAMES[id] })),
			...(savedTarget === "custom" ? [{ value: "custom", label: t("browserConnection.customTarget") }] : []),
		],
		targetDescription:
			target === "custom"
				? t("browserConnection.customTargetHint")
				: targets.defaultApplication
					? t(
							targets.defaultBrowser
								? "browserConnection.detectedDefault"
								: "browserConnection.unsupportedDefault",
							{
								browser: targets.defaultBrowser
									? BROWSER_NAMES[targets.defaultBrowser]
									: targets.defaultApplication,
							},
						)
					: t("browserConnection.unknownDefault"),
		targetSummary: isBrowserTargetId(target)
			? t(
					enabled && target !== savedTarget
						? "browserConnection.pendingTarget"
						: "browserConnection.selectedTarget",
					{ browser: BROWSER_NAMES[target] },
				)
			: t(target === "custom" ? "browserConnection.customTargetHint" : "browserConnection.chooseTarget"),
		targetDirty: target !== savedTarget,
		canInstall: isBrowserTargetId(target),
		canSave: Boolean(target),
		copiedStoreLink,
		loading,
		saving,
		enabled,
		conflict,
		token,
		profile,
		feedback,
		error: conflict ? t("browserConnection.conflict") : error ? t(`browserConnection.${error}`) : undefined,
		labels: {
			target: t("browserConnection.target"),
			chooseTarget: t("browserConnection.chooseTarget"),
			saveTarget: t("browserConnection.saveTarget"),
			targetHint: t("browserConnection.targetHint"),
			title: t("browserConnection.title"),
			description: t("browserConnection.description"),
			setup: t("browserConnection.setup"),
			startInstall: t(
				target === "msedge" ? "browserConnection.startBundledInstall" : "browserConnection.startInstall",
			),
			connection: t("browserConnection.connection"),
			state: t(
				loading
					? "browserConnection.loading"
					: saving
						? "browserConnection.saving"
						: enabled
							? "browserConnection.configured"
							: "browserConnection.notConfigured",
			),
			enable: t("browserConnection.enable"),
			save: t("browserConnection.save"),
			disable: t("browserConnection.disable"),
			retry: t("browserConnection.retry"),
			advanced: t("browserConnection.advanced"),
			token: t("browserConnection.token"),
			tokenHint: t("browserConnection.tokenHint"),
			profile: t("browserConnection.profile"),
			profileHint: t("browserConnection.profileHint"),
			guide: t("browserConnection.guide"),
		},
		guideLabels: {
			bundleTitle: t("browserConnection.setupGuide.bundleTitle"),
			bundleBody: t("browserConnection.setupGuide.bundleBody"),
			prepareBundle: t("browserConnection.setupGuide.prepareBundle"),
			copyDirectory: t("browserConnection.setupGuide.copyDirectory"),
			copiedDirectory: t("browserConnection.setupGuide.copiedDirectory"),
			loadTitle: t("browserConnection.setupGuide.loadTitle"),
			loadSteps: [
				t("browserConnection.setupGuide.developerMode"),
				t("browserConnection.setupGuide.loadUnpacked"),
				t("browserConnection.setupGuide.chooseDirectory"),
			],
			bundleHint: t("browserConnection.setupGuide.bundleHint"),
			title: t("browserConnection.setupGuide.title"),
			description: t("browserConnection.setupGuide.description"),
			installTitle: t("browserConnection.setupGuide.installTitle"),
			installBody: t("browserConnection.setupGuide.installBody"),
			chrome: t("browserConnection.setupGuide.chrome"),
			chromeInstructions: t("browserConnection.setupGuide.chromeInstructions"),
			edge: t("browserConnection.setupGuide.edge"),
			edgeInstructions: t("browserConnection.setupGuide.edgeInstructions"),
			openStore: t("browserConnection.setupGuide.openStore"),
			copyLink: t("browserConnection.setupGuide.copyLink"),
			copied: t("browserConnection.setupGuide.copied"),
			wrongBrowser: t("browserConnection.setupGuide.wrongBrowser"),
			configureTitle: t("browserConnection.setupGuide.configureTitle"),
			configureBody: t("browserConnection.setupGuide.configureBody"),
			configured: t("browserConnection.setupGuide.configured"),
			authorizeTitle: t("browserConnection.setupGuide.authorizeTitle"),
			authorizeBody: t("browserConnection.setupGuide.authorizeBody"),
			tryPrompt: t("browserConnection.setupGuide.tryPrompt"),
			troubleshooting: t("browserConnection.setupGuide.troubleshooting"),
			troubleshootingBody: t("browserConnection.setupGuide.troubleshootingBody"),
			advancedHint: t("browserConnection.setupGuide.advancedHint"),
			close: t("browserConnection.setupGuide.close"),
		},
		actions: {
			startInstall: () => {
				void updateConnection(target === "msedge" ? "bundled" : "install");
			},
			prepareBundle: () => {
				void updateConnection("bundled");
			},
			copyDirectory: () => {
				void copyText("directory");
			},
			copyStoreLink: () => {
				void copyText("link");
			},
			openStore: () => {
				void updateConnection("store");
			},
			setTarget: (value) => {
				if (!isBrowserTargetId(value) && value !== "custom") return;
				setTarget(value);
				setFeedback(undefined);
				setError((current) => (current === "targetUnavailable" ? undefined : current));
			},
			openGuide: () => {
				void openExternal(BROWSER_EXTENSION_GUIDE_URL);
			},
			reload: () => setReload((value) => value + 1),
			save: () => {
				void updateConnection("configure");
			},
			disable: () => {
				void updateConnection("disable");
			},
			setToken: (value) => {
				setToken(value);
				setFeedback(undefined);
			},
			setProfile: (value) => {
				setProfile(value);
				setFeedback(undefined);
			},
		},
	};
}
