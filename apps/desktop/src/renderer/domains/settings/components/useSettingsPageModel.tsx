import { useNavigate, useParams, useRouter, useSearch } from "@tanstack/react-router";
import { Button } from "@shared/components/ui/button";
import { useNarrowScreen } from "@shared/hooks/useNarrowScreen";
import { isMac, isWindows } from "@shared/lib/platform";
import {
	isPersonalModeAtom,
	pageHeaderLeftSlotAtom,
	pageHeaderTitleHiddenAtom,
	settingsReturnHrefAtom,
	type SettingsTab,
} from "@shared/store/atoms";
import { authUserAtom } from "@shared/store/auth-atoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { parseWorkspaceViewRef, workspaceViewNavKey } from "../../plugins/runtime/workspace-view-registry";
import { filterVisibleSettingsTabs, findSettingsSection, SETTINGS_TABS } from "../registry";
import type { SettingsNavigationItem, SettingsPageModel } from "./types";
import { useExtensionsSettingsModel } from "./useExtensionsSettingsModel";

export function useSettingsPageModel(): SettingsPageModel {
	const { t } = useTranslation("settings");
	const { tab: rawTab } = useParams({ strict: false }) as { tab?: string };
	const search = useSearch({ strict: false }) as Record<string, unknown>;
	const navigate = useNavigate();
	const router = useRouter();
	const isPersonal = useAtomValue(isPersonalModeAtom);
	const authUser = useAtomValue(authUserAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftSlotAtom);
	const narrow = useNarrowScreen(720);
	const returnHref = useAtomValue(settingsReturnHrefAtom);
	const highlightingRef = useRef(false);

	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);

	useEffect(() => {
		const back = t("backToWorkspace");
		setHeaderLeftSlot(
			<Button
				variant="ghost"
				size="sm"
				className="gap-2"
				title={back}
				aria-label={back}
				onClick={() => router.history.push(returnHref)}
			>
				<span aria-hidden="true" className="icon-[solar--arrow-left-linear] h-4 w-4" />
				{back}
			</Button>,
		);
		return () => setHeaderLeftSlot(null);
	}, [setHeaderLeftSlot, router, returnHref, t]);

	const visibleTabRegistrations = useMemo(
		() =>
			filterVisibleSettingsTabs(SETTINGS_TABS, {
				isPersonal,
				hasAuthUser: Boolean(authUser),
				isMac,
				isWindows,
			}),
		[authUser, isPersonal],
	);
	const validTabKeys = useMemo(
		() => new Set(visibleTabRegistrations.map((tab) => tab.key)),
		[visibleTabRegistrations],
	);
	const activeTab: SettingsTab =
		rawTab && validTabKeys.has(rawTab as SettingsTab) ? (rawTab as SettingsTab) : "general";
	const sectionId = getTargetSectionId(search);
	/** 设置壳内嵌打开的插件工作区视图；保留 extensions 路由兼容旧深链。 */
	const embeddedView = useMemo(() => {
		const raw = typeof search.view === "string" ? search.view : undefined;
		return raw && activeTab === "extensions" ? (parseWorkspaceViewRef(raw) ?? undefined) : undefined;
	}, [activeTab, search.view]);
	const navigationNonce = typeof search.nav === "string" ? search.nav : undefined;
	const targetSection = sectionId ? findSettingsSection(sectionId) : undefined;

	// MCP 已并入能力页（ADR-0049）；旧 /settings/mcp 与 mcp-* section 深链重定向过去。
	useEffect(() => {
		if (rawTab === "mcp" || targetSection?.tab === "mcp") {
			void navigate({ to: "/abilities", replace: true });
		}
	}, [navigate, rawTab, targetSection]);

	useEffect(() => {
		if (!targetSection || targetSection.tab === activeTab || !validTabKeys.has(targetSection.tab)) {
			return;
		}
		if (targetSection.tab === "mcp") return;
		void navigate({
			to: "/settings/$tab",
			params: { tab: targetSection.tab },
			search: { section: targetSection.id },
		});
	}, [activeTab, navigate, targetSection, validTabKeys]);

	useEffect(() => {
		if (!targetSection || targetSection.tab !== activeTab || highlightingRef.current) return;

		const element = document.getElementById(targetSection.id);
		if (!element) return;

		highlightingRef.current = true;
		element.scrollIntoView({ behavior: "smooth", block: "center" });

		const target =
			document.querySelector<HTMLElement>(`[data-setting-section-highlight-target="${targetSection.id}"]`) ??
			(element.closest(".mb-6") as HTMLElement | null) ??
			element;

		const timer = setTimeout(() => {
			target.classList.add("setting-section-breathe");
		}, 500);
		const cleanupTimer = setTimeout(() => {
			target.classList.remove("setting-section-breathe");
			highlightingRef.current = false;
		}, 4100);

		return () => {
			clearTimeout(timer);
			clearTimeout(cleanupTimer);
			target.classList.remove("setting-section-breathe");
			highlightingRef.current = false;
		};
	}, [activeTab, navigationNonce, targetSection]);

	const toNavigationItem = useCallback(
		(tab: (typeof visibleTabRegistrations)[number]): SettingsNavigationItem => {
			const label = t(tab.labelKey);
			return {
				beta: tab.beta,
				icon: tab.icon,
				key: tab.key,
				label,
				title: narrow ? label : undefined,
			};
		},
		[narrow, t],
	);
	// 插件入口与内置设置同级；extensions 仅作为旧链接与空态的内容路由。
	const extensionEntries = useExtensionsSettingsModel().entries;
	const extensionsByKey = useMemo(
		() => new Map(extensionEntries.map((entry) => [entry.key, entry])),
		[extensionEntries],
	);
	const tabs = useMemo<readonly SettingsNavigationItem[]>(
		() => [
			...visibleTabRegistrations.filter((tab) => tab.key !== "extensions").map(toNavigationItem),
			...extensionEntries.map((entry, index) => ({
				key: entry.key,
				label: entry.label,
				icon: entry.icon,
				iconUrl: entry.iconUrl,
				title: narrow ? entry.label : entry.description || entry.pluginName,
				separatorBefore: index === 0,
			})),
		],
		[extensionEntries, narrow, toNavigationItem, visibleTabRegistrations],
	);

	return {
		activeTab,
		embeddedView,
		activeNavigationKey: embeddedView ? workspaceViewNavKey(embeddedView.pluginId, embeddedView.viewId) : activeTab,
		onCloseEmbeddedView: () => {
			void navigate({ to: "/settings/$tab", params: { tab: "general" }, search: {} });
		},
		betaBadgeLabel: t("betaBadge"),
		narrow,
		onSelectNavigation: (key) => {
			const extension = extensionsByKey.get(key);
			if (extension) {
				extension.open();
				return;
			}
			const tab = visibleTabRegistrations.find((item) => item.key === key);
			if (tab) void navigate({ to: "/settings/$tab", params: { tab: tab.key }, search: {} });
		},
		tabs,
		title: t("title"),
	};
}

function getTargetSectionId(search: Record<string, unknown>): string | undefined {
	if (typeof search.section === "string") return search.section;
	if (typeof search.h2 === "string") return search.h2;
	return undefined;
}
