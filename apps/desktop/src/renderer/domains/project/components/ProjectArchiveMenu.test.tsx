// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import { projectContextMenuAtom } from "@shared/store/atoms";
import { ProjectRowView } from "@vetta-org/theme-ui/project";
import { createStore, Provider, useAtom } from "jotai";
import i18n from "i18next";
import { expect, it, vi } from "vitest";
import { useProjectGroupModel } from "../hooks/useProjectGroupModel";
import { ProjectContextMenu } from "./ProjectContextMenu";

it("opens the existing archive menu from the visible project action without navigating or deleting", async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	const archive = vi.fn(),
		remove = vi.fn(),
		navigate = vi.fn();
	function Project() {
		const [menu, setMenu] = useAtom(projectContextMenuAtom);
		const model = useProjectGroupModel({
			project: { cwd: "/fixture/project", name: "Project", isDefault: false, type: "normal", sessionCount: 0 },
			sessions: [],
			isExpanded: false,
			activeSessionPath: "",
			activeTeamSessionId: "",
			onExpand: vi.fn(),
			onCollapse: vi.fn(),
			onNavigateProject: navigate,
			onNewSession: vi.fn(),
			onSelectSession: vi.fn(),
			onRenameSession: vi.fn(),
		});
		return (
			<>
				<ProjectRowView
					displayName={model.displayName}
					projectCwd={model.project.cwd}
					projectType={model.projectType}
					hasRunning={false}
					isActive={false}
					expanded={false}
					newSessionTitle={model.newSessionTitle}
					contextMenuTitle={model.projectActionsTitle}
					onExpand={model.actions.expand}
					onCollapse={model.actions.collapse}
					onNavigateProject={model.actions.navigateProject}
					onNewSession={model.actions.newSession}
					onOpenContextMenu={model.actions.openProjectContextMenu}
				/>
				{menu && (
					<ProjectContextMenu
						{...menu}
						onClose={() => setMenu(null)}
						onArchive={archive}
						onRemove={remove}
						onDelete={remove}
					/>
				)}
			</>
		);
	}
	render(
		<Provider store={createStore()}>
			<Project />
		</Provider>,
	);
	const user = userEvent.setup();
	const trigger = screen.getByRole("button", { name: "项目操作" });
	trigger.focus();
	await user.keyboard("{Enter}");
	await user.click(await screen.findByRole("button", { name: "归档项目" }));
	expect(archive).toHaveBeenCalledWith("/fixture/project");
	expect(remove).not.toHaveBeenCalled();
	expect(navigate).not.toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "归档项目" })).toBeNull();
});
