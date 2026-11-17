import { isSshProjectUri } from "@567agent/ssh-transport/project-uri";
import { useShortcutBinding } from "@shared/hooks/useShortcutBinding";
import { shortcutParts } from "@shared/lib/platform";
import { useShortcutScope } from "@shared/shortcuts";
import {
	confirmDialogAtom,
	conversationTagEditorAtom,
	conversationTagsAtom,
	manageSessionsProjectAtom,
	pinnedSessionPathsAtom,
	runningSessionPathsAtom,
	sessionDisplayLabel,
	setSessionPinnedAtom,
} from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import type { CommandMenuItemView } from "@vetta-org/theme-ui/overlays";
import type {
	ManageSessionsMenuItemView,
	ManageSessionsSplashViewProps,
	ManageSessionsTabView,
} from "@vetta-org/theme-ui/project";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { conversationTagIds } from "../../../../shared/conversation-tags";
import type { ProjectsPanelModel } from "../components/sidebar/projects/panel/types";
import { filterManageSessions, moveSelection } from "../services/manage-sessions";
import { type SidebarConversationInfo, sidebarConversationIdentity } from "../services/sidebar-conversation-projection";
import { buildSidebarSessionOrdering } from "../services/sidebar-session-order";

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
const MODIFIER_LABEL = isMac ? "⌘" : "Ctrl";

type MenuKind = "actions" | "tags";

const ALL_TAB_ID = "all";

interface SessionView {
	readonly id: string;
	readonly label: string;
	readonly iconClassName?: string;
	readonly session: SidebarConversationInfo;
}

/**
 * 「管理会话」面板的状态与动作。数据来自侧栏同一份 panel model（置顶排序、claw 只读等规则一致），
 * 单个会话的操作沿用侧栏右键菜单的同一批 atom / 接口，不另起一套。
 */
export function useManageSessionsModel(panel: ProjectsPanelModel): ManageSessionsSplashViewProps {
	const { t, i18n } = useTranslation("project");
	const moreShortcut = useShortcutBinding("manage-session-actions");
	const reportFailure = useCallback(() => {
		showToast({ variant: "error", message: t("manageSessions.operationFailed") });
	}, [t]);
	const [project, setProject] = useAtom(manageSessionsProjectAtom);
	const open = project !== null;
	// 关闭动画期间 project 已经是 null，保留最后一个，面板淡出时内容不会瞬间清空。
	const lastProjectRef = useRef(project);
	if (project) lastProjectRef.current = project;
	const shown = project ?? lastProjectRef.current;

	const pinnedPaths = useAtomValue(pinnedSessionPathsAtom);
	const runningPaths = useAtomValue(runningSessionPathsAtom);
	const tags = useAtomValue(conversationTagsAtom);
	const setPinned = useSetAtom(setSessionPinnedAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const openTagEditor = useSetAtom(conversationTagEditorAtom);

	const [step, setStep] = useState<ManageSessionsSplashViewProps["step"]>("list");
	const [menuKind, setMenuKind] = useState<MenuKind>("actions");
	const [query, setQuery] = useState("");
	const [tabId, setTabId] = useState(ALL_TAB_ID);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [targetId, setTargetId] = useState<string | null>(null);
	const [menuActiveId, setMenuActiveId] = useState<string | null>(null);
	const [renameValue, setRenameValue] = useState("");

	// 每次打开都从干净的列表开始，不带上次的搜索词与步骤。
	useEffect(() => {
		if (!open) return;
		setStep("list");
		setMenuKind("actions");
		setQuery("");
		setTabId(ALL_TAB_ID);
		setSelectedId(null);
		setTargetId(null);
	}, [open]);

	const isDefault = shown?.isDefault === true;
	const isClaw = isDefault && panel.defaultConversationFilter === "claw";
	const allowMutations = !isClaw;
	const canTag = isDefault && !isClaw;
	const sessionsCwd = shown ? (isDefault ? panel.defaultSessionsCwd || shown.cwd : shown.cwd) : "";
	// 项目没展开过时 sessionsMap 里还没有它的会话，打开面板就主动加载。
	const loadSessionsRef = useRef(panel.actions.loadSessions);
	loadSessionsRef.current = panel.actions.loadSessions;
	useEffect(() => {
		if (open && sessionsCwd) loadSessionsRef.current(sessionsCwd);
	}, [open, sessionsCwd]);
	const sessionsLoading = shown
		? isDefault
			? panel.defaultSessionsLoading
			: panel.projectSessionsLoading(shown.cwd)
		: false;
	const rawSessions = shown ? (isDefault ? panel.defaultSessions : panel.projectSessions(shown.cwd)) : [];

	const views = useMemo<SessionView[]>(() => {
		void i18n.language;
		const ordered = buildSidebarSessionOrdering(rawSessions, pinnedPaths, Number.MAX_SAFE_INTEGER, true).all;
		return ordered.map((session) => {
			const identity = sidebarConversationIdentity(session, {
				conversationLabel: session.kind === "conversation" ? sessionDisplayLabel(session) : undefined,
				untitledTeamLabel: t("sidebar.session.untitledTeam"),
			});
			return { id: identity.key, label: identity.label, iconClassName: identity.iconClassName, session };
		});
	}, [rawSessions, pinnedPaths, t, i18n.language]);

	// 标签页只给「对话」：项目内会话没有标签，且至少有一个标签才有切换的意义。
	const tabs = useMemo<ManageSessionsTabView[]>(
		() =>
			canTag && tags.tags.length > 0
				? [
						{ id: ALL_TAB_ID, label: t("manageSessions.tabAll") },
						...tags.tags.map((tag) => ({ id: tag.id, label: tag.name, dotColor: tag.color })),
					]
				: [],
		[canTag, t, tags.tags],
	);
	const activeTabId = tabs.some((tab) => tab.id === tabId) ? tabId : ALL_TAB_ID;
	const tabViews = useMemo(
		() =>
			activeTabId === ALL_TAB_ID
				? views
				: views.filter((view) => conversationTagIds(tags, view.session.path).includes(activeTabId)),
		[activeTabId, tags, views],
	);
	const matches = useMemo(() => filterManageSessions(tabViews, query), [tabViews, query]);
	const rowIds = useMemo(() => matches.map((match) => match.item.id), [matches]);
	const effectiveSelectedId = selectedId !== null && rowIds.includes(selectedId) ? selectedId : (rowIds[0] ?? null);
	const viewById = useMemo(() => new Map(views.map((view) => [view.id, view])), [views]);
	const targetView = targetId ? viewById.get(targetId) : undefined;

	const tagColorsOf = useCallback(
		(path: string): readonly string[] | undefined => {
			const colors = conversationTagIds(tags, path)
				.map((id) => tags.tags.find((tag) => tag.id === id)?.color)
				.filter((color): color is string => Boolean(color));
			return colors.length > 0 ? colors : undefined;
		},
		[tags],
	);

	const rows = useMemo<CommandMenuItemView[]>(
		() =>
			matches.map(({ item, ranges }) => ({
				id: item.id,
				title: item.label,
				titleHighlights: ranges,
				subtitle: new Date(item.session.modifiedAt).toLocaleDateString(i18n.language, {
					month: "numeric",
					day: "numeric",
				}),
				icon: pinnedPaths.has(item.session.path)
					? "icon-[solar--pin-bold]"
					: (item.iconClassName ?? "icon-[solar--chat-round-line-linear]"),
				tagColors: canTag ? tagColorsOf(item.session.path) : undefined,
				badge: runningPaths.has(item.session.path) ? t("manageSessions.running") : undefined,
			})),
		[canTag, i18n.language, matches, pinnedPaths, runningPaths, t, tagColorsOf],
	);

	const close = useCallback(() => setProject(null), [setProject]);

	const canDeleteSession = useCallback(
		(session: SidebarConversationInfo): boolean =>
			allowMutations && session.kind === "conversation" && session.access?.delete !== false,
		[allowMutations],
	);
	const canRenameSession = useCallback(
		(session: SidebarConversationInfo): boolean =>
			allowMutations && session.kind === "conversation" && session.access?.rename !== false,
		[allowMutations],
	);

	const deleteView = useCallback(
		(view: SessionView): void => {
			const { session } = view;
			if (!canDeleteSession(session)) return;
			const run = (): void => {
				// 会话没了，它留下的标注就是孤儿；与侧栏删除保持一致。
				void panel.actions
					.deleteConversation(session)
					.then(() => window.agent567.conversationTags.forgetConversations([session.path]))
					.catch(reportFailure);
			};
			setConfirm({
				title: t("sidebar.dialogs.deleteSessionTitle"),
				message: t("sidebar.dialogs.deleteSessionMessage", { name: view.label }),
				confirmLabel: t("sidebar.dialogs.deleteConfirm"),
				variant: "danger",
				onConfirm: run,
			});
		},
		[canDeleteSession, panel.actions, reportFailure, setConfirm, t],
	);

	const openRow = useCallback(
		(id: string): void => {
			const view = viewById.get(id);
			if (!view) return;
			close();
			if (isDefault) panel.actions.defaultSelectSession(sessionsCwd, view.session);
			else panel.actions.selectSession(sessionsCwd, view.session);
		},
		[close, isDefault, panel.actions, sessionsCwd, viewById],
	);

	const runningInScope = views.some((view) => runningPaths.has(view.session.path));
	const deletableViews = views.filter((view) => canDeleteSession(view.session));
	const clearAll = useCallback((): void => {
		if (!shown || runningInScope) return;
		const sessions = views.filter((view) => canDeleteSession(view.session)).map((view) => view.session);
		if (sessions.length === 0) return;
		close();
		setConfirm({
			title: t("manageSessions.clearProjectTitle"),
			message: t("manageSessions.clearProjectMessage", { count: sessions.length, name: shown.name ?? shown.cwd }),
			confirmLabel: t("sidebar.dialogs.clearConfirm"),
			variant: "danger",
			onConfirm: () => {
				void (async () => {
					for (const session of sessions) {
						await panel.actions.deleteConversation(session);
						await window.agent567.conversationTags.forgetConversations([session.path]);
					}
				})().catch(reportFailure);
			},
		});
	}, [canDeleteSession, close, panel.actions, reportFailure, runningInScope, setConfirm, shown, t, views]);

	const menuItems = useMemo<ManageSessionsMenuItemView[]>(() => {
		if (!targetView) return [];
		const { session } = targetView;
		if (menuKind === "tags") {
			const assigned = new Set(conversationTagIds(tags, session.path));
			return [
				...tags.tags.map((tag) => ({
					id: `tag:${tag.id}`,
					label: tag.name,
					dotColor: tag.color,
					checked: assigned.has(tag.id),
				})),
				{ id: "tag-new", label: t("contextMenu.tags.new"), icon: "icon-[solar--add-circle-linear]" },
			];
		}
		const pinned = pinnedPaths.has(session.path);
		const items: ManageSessionsMenuItemView[] = [
			{
				id: "pin",
				label: pinned ? t("contextMenu.unpin") : t("contextMenu.pin"),
				icon: "icon-[solar--pin-linear]",
			},
		];
		if (canRenameSession(session)) {
			items.push({ id: "rename", label: t("contextMenu.rename"), icon: "icon-[solar--pen-2-linear]" });
		}
		if (canTag) {
			items.push({ id: "tags", label: t("manageSessions.moveToTag"), icon: "icon-[solar--tag-linear]" });
		}
		// 远程项目下的会话，工作目录在远端，系统文件管理器无从显示。
		if (!isSshProjectUri(session.cwd)) {
			items.push({
				id: "open-in-folder",
				label: isMac ? t("contextMenu.openInFinder") : t("contextMenu.openInExplorer"),
				icon: "icon-[solar--folder-open-linear]",
			});
		}
		if (canDeleteSession(session)) {
			items.push({
				id: "delete",
				label: t("contextMenu.delete"),
				icon: "icon-[solar--trash-bin-trash-linear]",
				danger: true,
			});
		}
		return items;
	}, [canDeleteSession, canRenameSession, canTag, menuKind, pinnedPaths, t, tags, targetView]);

	const menuIds = useMemo(() => menuItems.filter((item) => !item.disabled).map((item) => item.id), [menuItems]);
	const effectiveMenuActiveId =
		menuActiveId !== null && menuIds.includes(menuActiveId) ? menuActiveId : (menuIds[0] ?? null);

	const backToList = useCallback((): void => {
		setStep("list");
		setMenuKind("actions");
	}, []);

	const openMenuFor = useCallback(
		(id: string | null): void => {
			if (!id) return;
			const view = viewById.get(id);
			if (!view) return;
			setTargetId(id);
			setMenuKind("actions");
			setMenuActiveId(null);
			setStep("menu");
		},
		[viewById],
	);

	const selectMenuItem = useCallback(
		(id: string): void => {
			if (!targetView) return;
			const { session } = targetView;
			if (menuKind === "tags") {
				if (id === "tag-new") {
					// 标签编辑是另一个对话框，层级在 Splash 之下，先收起面板再打开。
					close();
					openTagEditor({ mode: "create", sessionPath: session.path });
					return;
				}
				const tagId = id.slice("tag:".length);
				const assigned = new Set(conversationTagIds(tags, session.path)).has(tagId);
				void window.agent567.conversationTags
					.assign({ sessionPath: session.path, tagId, assigned: !assigned })
					.catch(reportFailure);
				backToList();
				return;
			}
			switch (id) {
				case "pin":
					setPinned({ path: session.path, pinned: !pinnedPaths.has(session.path) });
					backToList();
					return;
				case "rename":
					setRenameValue(targetView.label);
					setStep("rename");
					return;
				case "tags":
					setMenuKind("tags");
					setMenuActiveId(null);
					return;
				case "open-in-folder":
					void window.agent567.shell.showInFolder(session.cwd).catch(reportFailure);
					close();
					return;
				case "delete":
					deleteView(targetView);
					backToList();
					return;
			}
		},
		[backToList, close, deleteView, menuKind, openTagEditor, pinnedPaths, reportFailure, setPinned, tags, targetView],
	);

	const moreRow = useCallback(
		(id: string): void => {
			setSelectedId(id);
			openMenuFor(id);
		},
		[openMenuFor],
	);

	const submitRename = useCallback((): void => {
		const name = renameValue.trim();
		if (!targetView || !name || name === targetView.label) {
			backToList();
			return;
		}
		const { session } = targetView;
		if (!canRenameSession(session)) return;
		void Promise.resolve(panel.actions.renameSession(sessionsCwd, session.path, name))
			.then(backToList)
			.catch(reportFailure);
	}, [backToList, canRenameSession, panel.actions, renameValue, reportFailure, sessionsCwd, targetView]);

	const goBack = useCallback((): void => {
		if (step === "menu" && menuKind === "tags") {
			setMenuKind("actions");
			setMenuActiveId(null);
			return;
		}
		backToList();
	}, [backToList, menuKind, step]);

	useShortcutScope({
		id: "overlay:manage-sessions",
		kind: "modal",
		active: open,
		exclusive: true,
		bindings: [
			{ key: "escape", run: () => (step === "list" ? close() : goBack()) },
			...(["arrowdown", "arrowup"] as const).map((key) => ({
				key,
				enabled: () => step !== "rename",
				run: () => {
					const delta = key === "arrowdown" ? 1 : -1;
					if (step === "list") setSelectedId(moveSelection(rowIds, effectiveSelectedId, delta));
					else if (step === "menu") setMenuActiveId(moveSelection(menuIds, effectiveMenuActiveId, delta));
				},
			})),
			{ key: moreShortcut, run: () => (step === "list" ? openMenuFor(effectiveSelectedId) : goBack()) },
			{
				key: "arrowleft",
				when: "not-editable",
				run: () => {
					if (step === "menu") goBack();
				},
			},
		],
	});

	return {
		open,
		step,
		modifierLabel: MODIFIER_LABEL,
		moreShortcutKeys: moreShortcut ? shortcutParts(moreShortcut) : [],
		onClose: close,
		labels: {
			title: t("manageSessions.title"),
			searchPlaceholder: t("manageSessions.searchPlaceholder"),
			searchLabel: t("manageSessions.searchLabel"),
			empty: sessionsLoading
				? t("manageSessions.loading")
				: tabViews.length === 0 && !query.trim() && activeTabId === ALL_TAB_ID
					? t("manageSessions.emptyAll")
					: t("manageSessions.emptyQuery"),
			back: t("addProjectSplash.back"),
			renamePlaceholder: t("manageSessions.renamePlaceholder"),
			renameLabel: t("contextMenu.rename"),
			clearAll: t("manageSessions.clearAll"),
			clearAllDisabled: t("contextMenu.clearConversationDisabled"),
			hintMore: t("manageSessions.hintMore"),
			hintClose: t("addProjectSplash.hintClose"),
			hintBack: t("addProjectSplash.hintBack"),
			hintSelect: t("addProjectSplash.hintSelect"),
			hintRename: t("manageSessions.hintRename"),
		},
		tabs,
		activeTabId,
		onSelectTab: setTabId,
		query,
		onQueryChange: setQuery,
		rows,
		selectedId: effectiveSelectedId,
		onHoverRow: setSelectedId,
		onOpenRow: openRow,
		onMoreRow: moreRow,
		clearAllVisible: deletableViews.length > 0,
		clearAllDisabled: runningInScope,
		clearAllDisabledReason: t("contextMenu.clearConversationDisabled"),
		onClearAll: clearAll,
		menuTitle: menuKind === "tags" ? t("manageSessions.moveToTag") : (targetView?.label ?? ""),
		menuItems,
		menuActiveId: effectiveMenuActiveId,
		onHoverMenuItem: setMenuActiveId,
		onSelectMenuItem: selectMenuItem,
		renameValue,
		onRenameChange: setRenameValue,
		onRenameSubmit: submitRename,
		onBack: goBack,
	};
}
