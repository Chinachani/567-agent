// @vitest-environment jsdom
import type { Project, SessionInfo } from "@shared/store/atoms";
import type { SidebarConversationInfo } from "../../../services/sidebar-conversation-projection";
import type { JSX } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setConfirmDialog = vi.fn();
const deleteSession = vi.fn(async () => undefined);
const exportMigrationArchive = vi.fn(async () => ({ canceled: false, sessionCount: 1 }));
const session: SidebarConversationInfo = {
	kind: "conversation",
	id: "project-session",
	path: "/projects/a1/.567agent/sessions/project.jsonl",
	cwd: "/projects/a1",
	firstMessage: "Project chat",
	modifiedAt: 10,
	access: { readHistory: true, resume: true, rename: true, delete: true },
};
const mockModel = {
	displayName: "A1",
	expanded: true,
	hasMoreSessions: false,
	hasRunning: false,
	hiddenCount: 0,
	isActive: false,
	newSessionTitle: "New session",
	noSessionsLabel: "No sessions",
	project: { cwd: "/projects/a1", name: "A1" },
	projectBadge: undefined,
	projectType: "normal",
	sessionViews: [{
		key: "conversation:project-session",
		path: session.path,
		label: "Project chat",
		active: false,
		renaming: false,
		running: false,
		scheduled: false,
		pinned: false,
		session,
	}],
	showAllSessions: true,
	showMoreLabels: { collapse: "Collapse", expand: "Expand" },
	actions: {
		collapse: vi.fn(), expand: vi.fn(), navigateProject: vi.fn(), newSession: vi.fn(),
		openProjectContextMenu: vi.fn(), openSessionContextMenu: vi.fn(), renameDone: vi.fn(),
		renameSession: vi.fn(), selectSession: vi.fn(), toggleShowAll: vi.fn(),
	},
};

vi.mock("@shared/store/atoms", () => ({ confirmDialogAtom: {} }));
vi.mock("jotai", () => ({ useSetAtom: () => setConfirmDialog }));
vi.mock("../../../hooks/useProjects", () => ({ useProjectActions: () => ({ deleteSession }) }));
vi.mock("../../../hooks/useProjectGroupModel", () => ({ useProjectGroupModel: () => mockModel }));
vi.mock("@vetta-org/theme-ui/project", () => ({
	ProjectGroupView: (props: { sessions: { sessions: Array<{ key: string }>; renderSession: (item: { key: string }) => JSX.Element } }): JSX.Element => (
		<div>{props.sessions.sessions.map((item) => props.sessions.renderSession(item))}</div>
	),
	SessionRowView: (props: { label: string; onSelect: () => void }): JSX.Element => (
		<button type="button" onClick={props.onSelect}>{props.label}</button>
	),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const { ProjectGroup } = await import("./ProjectGroup.js");

const project = { cwd: "/projects/a1", name: "A1", isDefault: false } as Project;
const renderProjectGroup = (): void => {
	render(
		<ProjectGroup
			project={project}
			scrollParent={null}
			sessions={[session]}
			sessionsLoading={false}
			isExpanded
			activeSessionPath=""
			activeTeamSessionId=""
			onExpand={() => {}}
			onCollapse={() => {}}
			onNavigateProject={() => {}}
			onNewSession={() => {}}
			onSelectSession={() => {}}
			onRenameSession={() => {}}
		/>,
	);
};

describe("ProjectGroup batch session actions", () => {
	beforeEach(() => {
		setConfirmDialog.mockClear();
		deleteSession.mockClear();
		exportMigrationArchive.mockClear();
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { session: { exportMigrationArchive } },
		});
	});

	it("selects and deletes conversations from a project group", async () => {
		renderProjectGroup();
		fireEvent.click(screen.getByRole("button", { name: "sidebar.defaultConversation.batchSelect" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Project chat" }));
		fireEvent.click(screen.getByRole("button", { name: "sidebar.defaultConversation.batchDelete" }));

		const confirmation = setConfirmDialog.mock.calls[0]?.[0] as { onConfirm: () => void };
		await act(async () => confirmation.onConfirm());
		await waitFor(() => expect(deleteSession).toHaveBeenCalledWith(session.cwd, session.path));
	});

	it("exports selected project conversations with their owning cwd", async () => {
		renderProjectGroup();
		fireEvent.click(screen.getByRole("button", { name: "sidebar.defaultConversation.batchSelect" }));
		fireEvent.click(screen.getByRole("checkbox", { name: "Project chat" }));
		fireEvent.change(screen.getByLabelText("sidebar.defaultConversation.batchPassword"), {
			target: { value: "safe-password-123" },
		});
		fireEvent.click(screen.getByRole("button", { name: "sidebar.defaultConversation.batchExport" }));

		await waitFor(() =>
			expect(exportMigrationArchive).toHaveBeenCalledWith(
				[session.id],
				"safe-password-123",
				project.cwd,
			),
		);
	});
});
