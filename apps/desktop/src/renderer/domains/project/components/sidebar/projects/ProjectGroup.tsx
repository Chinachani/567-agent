import type { Project } from "@shared/store/atoms";
import { Button } from "@shared/components/ui/button";
import { confirmDialogAtom } from "@shared/store/atoms";
import { ProjectGroupView, SessionRowView } from "@vetta-org/theme-ui/project";
import { useSetAtom } from "jotai";
import { showToast } from "@shared/store/toast-atoms";
import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare2, Download, ListChecks, Trash2, X } from "lucide-react";
import {
	type ProjectGroupSessionView,
	useProjectGroupModel,
} from "../../../hooks/useProjectGroupModel";
import type { SidebarConversationInfo } from "../../../services/sidebar-conversation-projection";
import {
	selectableConversationSessions,
	toggleAllSelectedSessionPaths,
	toggleSelectedSessionPath,
} from "../../../services/session-batch-selection";

/** 每行一个 memo 组件，per-row 回调在这里固定引用（理由同 DefaultSessionRow）。 */
const ProjectSessionRow = memo(function ProjectSessionRow({
	item,
	onOpenContextMenu,
	onRename,
	onRenameDone,
	onSelect,
	selectionMode,
	selected,
	onToggleSelected,
}: {
	item: ProjectGroupSessionView;
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
					className="mx-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
					type="checkbox"
					onChange={handleToggleSelected}
				/>
			) : null}
			<div className="min-w-0 flex-1">
				<SessionRowView
					active={item.active}
					iconClassName={item.iconClassName}
					label={item.label}
					pinned={item.pinned}
					renaming={item.renaming}
					running={item.running}
					scheduled={item.scheduled}
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

interface ProjectGroupProps {
	project: Project;
	scrollParent: HTMLElement | null;
	sessions: SidebarConversationInfo[];
	sessionsLoading: boolean;
	isExpanded: boolean;
	isActive?: boolean;
	activeSessionPath: string;
	activeTeamSessionId: string;
	onExpand: (cwd: string) => void;
	onCollapse: (cwd: string) => void;
	onNavigateProject: (cwd: string) => void;
	onNewSession: (cwd: string) => void;
	onSelectSession: (cwd: string, session: SidebarConversationInfo) => void;
	onDeleteSession: (session: SidebarConversationInfo) => Promise<void>;
	onRenameSession: (cwd: string, sessionPath: string, name: string) => void;
}

export const ProjectGroup = memo(function ProjectGroup(props: ProjectGroupProps): JSX.Element {
	const model = useProjectGroupModel(props);
	const { t } = useTranslation("project");
	const setConfirmDialog = useSetAtom(confirmDialogAtom);
	const [selectionMode, setSelectionMode] = useState(false);
	const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string>>(new Set());
	const [passphrase, setPassphrase] = useState("");
	const [busy, setBusy] = useState(false);
	const [batchMessage, setBatchMessage] = useState("");
	const selectableSessions = useMemo(() => selectableConversationSessions(props.sessions), [props.sessions]);
	const selectedSessions = useMemo(
		() => selectableSessions.filter((session) => selectedPaths.has(session.path)),
		[selectableSessions, selectedPaths],
	);
	const toggleSelected = useCallback((session: SidebarConversationInfo) => {
		if (session.kind !== "conversation") return;
		setSelectedPaths((previous) => toggleSelectedSessionPath(previous, session.path));
	}, []);
	const closeSelection = useCallback(() => {
		setSelectionMode(false);
		setSelectedPaths(new Set());
		setPassphrase("");
		setBatchMessage("");
	}, []);
	const toggleAll = useCallback(() => {
		setSelectedPaths((current) => toggleAllSelectedSessionPaths(current, props.sessions));
	}, [props.sessions]);
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
				selectedSessions.map((session) => session.id),
				passphrase,
				props.project.cwd,
			);
			if (!result.canceled) {
				showToast({
					variant: "success",
					message: t("sidebar.defaultConversation.batchExported", { count: result.sessionCount ?? selectedSessions.length }),
				});
				closeSelection();
			}
		} catch (error) {
			setBatchMessage(error instanceof Error ? error.message : String(error));
		} finally {
			setBusy(false);
		}
	}, [closeSelection, passphrase, props.project.cwd, selectedSessions, t]);
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
					for (const session of selectedSessions) {
						try {
							await props.onDeleteSession(session);
						} catch {
							failed.push(session.path);
						}
					}
					setBusy(false);
					if (failed.length > 0) {
						setBatchMessage(t("sidebar.defaultConversation.batchDeletePartial", { count: failed.length }));
						setSelectedPaths(new Set(failed));
					} else closeSelection();
				})();
			},
		});
	}, [closeSelection, props.onDeleteSession, selectedSessions, setConfirmDialog, t]);

	return (
		<div className="min-w-0">
			{selectionMode && model.expanded && selectableSessions.length > 0 ? (
				<div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-card/95 px-2 py-1.5 shadow-md backdrop-blur-sm">
					<>
							<span className="mr-1 text-xs font-medium text-foreground">
								{t("sidebar.defaultConversation.batchSelected", { count: selectedSessions.length })}
							</span>
							<Button size="xs" variant="outline" disabled={busy} onClick={toggleAll}>
								<CheckSquare2 aria-hidden="true" />
								{selectedSessions.length === selectableSessions.length
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
			<ProjectGroupView
			projectRow={{
				badge: model.projectBadge,
				displayName: model.displayName,
				expanded: model.expanded,
				hasRunning: model.hasRunning,
				isActive: model.isActive,
				newSessionTitle: model.newSessionTitle,
				onCollapse: model.actions.collapse,
				onExpand: model.actions.expand,
				onNavigateProject: model.actions.navigateProject,
				onNewSession: model.actions.newSession,
				onOpenContextMenu: model.actions.openProjectContextMenu,
				projectCwd: model.project.cwd,
				projectType: model.projectType,
				trailingAction: model.expanded && selectableSessions.length > 0 && !selectionMode ? (
					<Button
						aria-label={t("sidebar.defaultConversation.batchSelect")}
						title={t("sidebar.defaultConversation.batchSelect")}
						size="icon-xs"
						variant="ghost"
						onClick={(event) => {
							event.stopPropagation();
							setSelectionMode(true);
						}}
					>
						<ListChecks aria-hidden="true" />
					</Button>
				) : null,
			}}
			emptySessions={
				<p className="px-2.5 py-1.5 pl-[36px] text-[12px] text-muted-foreground">
					{model.noSessionsLabel}
				</p>
			}
			sessions={{
				expanded: model.expanded,
				hasMore: model.hasMoreSessions,
				loading: props.sessionsLoading,
				labels: model.showMoreLabels,
				onToggleShowAll: model.actions.toggleShowAll,
				scrollParent: props.scrollParent,
				sessions: model.sessionViews,
				showAll: model.showAllSessions,
				renderSession: (session) => (
					<ProjectSessionRow
						key={session.key}
						item={session}
						onOpenContextMenu={model.actions.openSessionContextMenu}
						onRename={model.actions.renameSession}
						onRenameDone={model.actions.renameDone}
						onSelect={model.actions.selectSession}
						selectionMode={selectionMode}
						selected={selectedPaths.has(session.path)}
						onToggleSelected={toggleSelected}
					/>
				),
			}}
			/>
		</div>
	);
});
