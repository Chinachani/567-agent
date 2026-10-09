import type { DefaultConversationFilter } from "@shared/store/atoms";
import { Button } from "@shared/components/ui/button";
import { confirmDialogAtom } from "@shared/store/atoms";
import { DefaultSessionListView, DefaultSessionRowView } from "@vetta-org/theme-ui/project";
import { useSetAtom } from "jotai";
import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare2, Download, Trash2, X } from "lucide-react";
import {
	type DefaultSessionListItemView,
	useDefaultSessionListModel,
} from "../../../../hooks/useDefaultSessionListModel";
import type { SidebarConversationInfo } from "../../../../services/sidebar-conversation-projection";
import { useProjectActions } from "../../../../hooks/useProjects";
import {
	selectableConversationSessions,
	toggleAllSelectedSessionPaths,
	toggleSelectedSessionPath,
} from "../../../../services/session-batch-selection";

/**
 * 每行一个 memo 组件，per-row 回调在这里用 useCallback 固定住。
 * 直接在 renderSession 里现造 onSelect/onRename/onOpenContextMenu 的话，
 * 三个箭头函数每次渲染都换引用，下游 DefaultSessionRowView 的 memo 会全部落空。
 */
const DefaultSessionRow = memo(function DefaultSessionRow({
	item,
	contextMenuEnabled,
	moreLabel,
	onOpenContextMenu,
	onRename,
	onRenameDone,
	onSelect,
	selectionMode,
	selected,
	onToggleSelected,
}: {
	item: DefaultSessionListItemView;
	contextMenuEnabled: boolean;
	moreLabel: string;
	onOpenContextMenu: (event: React.MouseEvent, session: SidebarConversationInfo) => void;
	onRename: (session: SidebarConversationInfo, name: string) => void;
	onRenameDone: () => void;
	onSelect: (session: SidebarConversationInfo) => void;
	selectionMode: boolean;
	selected: boolean;
	onToggleSelected: (session: SidebarConversationInfo) => void;
}): JSX.Element {
	const { session } = item;
	const handleContextMenu = useCallback(
		(event: React.MouseEvent) => onOpenContextMenu(event, session),
		[onOpenContextMenu, session],
	);
	const handleRename = useCallback((name: string) => onRename(session, name), [onRename, session]);
	const handleSelect = useCallback(() => onSelect(session), [onSelect, session]);
	const handleToggleSelected = useCallback(() => onToggleSelected(session), [onToggleSelected, session]);

	return (
		<div className="flex min-w-0 items-center gap-1">
			{selectionMode && session.kind === "conversation" ? (
				<input
					aria-label={item.label}
					checked={selected}
					type="checkbox"
					className="mx-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
					onChange={handleToggleSelected}
				/>
			) : null}
			<div className="min-w-0 flex-1">
				<DefaultSessionRowView
					active={item.active}
					contextMenuEnabled={contextMenuEnabled}
					iconClassName={item.iconClassName}
					label={item.label}
					moreLabel={moreLabel}
					pinned={item.pinned}
					renaming={item.renaming}
					running={item.running}
					scheduled={item.scheduled}
					tagColors={item.tagColors}
					trailingAvatarUrls={item.trailingAvatarUrls}
					titleExtra={item.titleExtra}
					onOpenContextMenu={handleContextMenu}
					onRename={handleRename}
					onRenameDone={onRenameDone}
					onSelect={handleSelect}
				/>
			</div>
		</div>
	);
});

interface DefaultSessionListProps {
	activeSessionPath: string;
	activeTeamSessionId: string;
	className?: string;
	cwd: string;
	filter: DefaultConversationFilter;
	loading: boolean;
	selectionMode: boolean;
	onSelectionModeChange: (active: boolean) => void;
	onNewSession?: () => void;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
	onSelectSession: (cwd: string, session: SidebarConversationInfo) => void;
	scrollParent: HTMLElement | null;
	sessions: SidebarConversationInfo[];
}

export const DefaultSessionList = memo(function DefaultSessionList(
	props: DefaultSessionListProps,
): JSX.Element {
	const model = useDefaultSessionListModel(props);
	const { t } = useTranslation("project");
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	const projectActions = useProjectActions();
	const selectionMode = props.selectionMode;
	const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set());
	const [passphrase, setPassphrase] = useState("");
	const [busy, setBusy] = useState(false);
	const [batchMessage, setBatchMessage] = useState("");
	const selectableSessions = useMemo(
		() => selectableConversationSessions(model.sessions.map((item) => item.session)),
		[model.sessions],
	);
	const selectedSessions = useMemo(
		() => model.sessions.filter((item) => item.session.kind === "conversation" && selectedPaths.has(item.path)),
		[model.sessions, selectedPaths],
	);
	const toggleSelected = useCallback((session: SidebarConversationInfo) => {
		if (session.kind !== "conversation") return;
		setSelectedPaths((previous) => toggleSelectedSessionPath(previous, session.path));
	}, []);
	const closeSelection = useCallback(() => {
		props.onSelectionModeChange(false);
		setSelectedPaths(new Set());
		setBatchMessage("");
	}, [props.onSelectionModeChange]);
	const exportSelected = useCallback(async () => {
		if (selectedSessions.length === 0) return;
		if (passphrase.length < 8 || passphrase.length > 128) {
			setBatchMessage(t("sidebar.defaultConversation.batchPasswordLength"));
			return;
		}
		setBusy(true);
		setBatchMessage("");
		try {
			const result = await window.agent567.session.exportMigrationArchive(
				selectedSessions.map((item) => item.session.id),
				passphrase,
				props.cwd,
			);
			if (!result.canceled) {
				setBatchMessage(t("sidebar.defaultConversation.batchExported", { count: result.sessionCount ?? selectedSessions.length }));
				setPassphrase("");
				closeSelection();
			}
		} catch (error) {
			setBatchMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	}, [closeSelection, passphrase, props.cwd, selectedSessions, t]);
	const requestDeleteSelected = useCallback(() => {
		if (selectedSessions.length === 0) return;
		setConfirmDialog({
			title: t("sidebar.defaultConversation.batchDeleteTitle"),
			message: t("sidebar.defaultConversation.batchDeleteMessage", { count: selectedSessions.length }),
			confirmLabel: t("sidebar.defaultConversation.batchDeleteConfirm"),
			variant: "danger",
			onConfirm: () => {
				void (async () => {
					setBusy(true);
					setBatchMessage("");
					const failed: string[] = [];
					for (const item of selectedSessions) {
						try {
							await projectActions.deleteSession(item.session.cwd, item.path);
						} catch {
							failed.push(item.path);
						}
					}
					setBusy(false);
					if (failed.length) {
						setBatchMessage(t("sidebar.defaultConversation.batchDeletePartial", { count: failed.length }));
						setSelectedPaths(new Set(failed));
					} else {
						closeSelection();
					}
				})();
			},
		});
	}, [closeSelection, projectActions, selectedSessions, setConfirmDialog, t]);
	const toggleAll = useCallback(() => {
		setSelectedPaths((current) =>
			toggleAllSelectedSessionPaths(current, model.sessions.map((item) => item.session)),
		);
	}, [model.sessions]);

	return (
		<div className="min-w-0">
			{selectionMode && props.filter !== "claw" && selectableSessions.length > 0 ? (
				<div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2 py-1.5 shadow-md backdrop-blur-sm">
						<>
							<span className="mr-1 text-xs font-medium text-foreground">
								{t("sidebar.defaultConversation.batchSelected", { count: selectedSessions.length })}
							</span>
							<Button size="xs" variant="outline" disabled={busy} onClick={toggleAll}>
								<CheckSquare2 aria-hidden="true" />
								{selectedPaths.size === selectableSessions.length
									? t("sidebar.defaultConversation.batchClearSelection")
									: t("sidebar.defaultConversation.batchSelectAll")}
							</Button>
							<input
								aria-label={t("sidebar.defaultConversation.batchPassword")}
								autoComplete="new-password"
								className="h-7 w-28 rounded-md border border-input bg-background px-2 text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
								maxLength={128}
								placeholder={t("sidebar.defaultConversation.batchPassword")}
								type="password"
								value={passphrase}
								onChange={(event) => setPassphrase(event.target.value)}
							/>
							<Button size="xs" variant="secondary" disabled={busy || selectedSessions.length === 0} onClick={() => void exportSelected()}>
								<Download aria-hidden="true" />
								{t("sidebar.defaultConversation.batchExport")}
							</Button>
							<Button size="xs" variant="destructive" disabled={busy || selectedSessions.length === 0} onClick={requestDeleteSelected}>
								<Trash2 aria-hidden="true" />
								{t("sidebar.defaultConversation.batchDelete")}
							</Button>
							<Button size="xs" variant="ghost" disabled={busy} onClick={closeSelection}>
								<X aria-hidden="true" />
								{t("sidebar.defaultConversation.batchCancel")}
							</Button>
						</>
					{batchMessage ? <span className="basis-full px-1 text-[11px] text-muted-foreground" role="status">{batchMessage}</span> : null}
				</div>
			) : null}
			<DefaultSessionListView
			className={props.className}
			hasMore={model.hasMore}
			labels={model.labels}
							loading={props.loading}
			onEmptyAction={model.actions.emptyAction}
			onToggleShowAll={model.actions.toggleShowAll}
			scrollParent={props.scrollParent}
			sessions={model.sessions}
			showAll={model.showAll}
			totalCount={model.totalCount}
			visibleSessions={model.visibleSessions}
			renderSession={(item) => (
				<DefaultSessionRow
					key={item.key}
					item={item}
					contextMenuEnabled={model.contextMenuEnabled}
					moreLabel={model.labels.more}
					onOpenContextMenu={model.actions.openContextMenu}
					onRename={model.actions.rename}
								onRenameDone={model.actions.renameDone}
								onSelect={model.actions.select}
								selectionMode={selectionMode}
								selected={selectedPaths.has(item.path)}
								onToggleSelected={toggleSelected}
							/>
							)}
			/>
		</div>
	);
});
