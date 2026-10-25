// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationPageView, TaskListView } from "@vetta-org/theme-ui/scheduler";
import { BatchTasksPageView } from "@vetta-org/theme-ui/batch-tasks";
import { SettingsSidebarView } from "@vetta-org/theme-ui/settings";

afterEach(cleanup);

describe("workspace page actions after the layout redesign", () => {
	it("lets users start from a template or create a task, then retains the populated list", async () => {
		const user = userEvent.setup();
		const onNewTask = vi.fn(),
			onSelectRecommendation = vi.fn();
		const props = {
			labels: {
				title: "Automation",
				subtitle: "Work on a schedule",
				newTask: "New task",
				newTaskTitle: "Create a task",
				recommendTitle: "Start from a template",
				recommendUse: "Use template",
			},
			onNewTask,
			taskList: <p>Saved task</p>,
			historyDrawer: null,
			taskFormDialog: null,
			recommendations: [
				{
					id: "review",
					icon: "icon-[solar--code-linear]",
					title: "Review project",
					description: "Check project changes",
					scheduleLabel: "Every Monday",
				},
			],
			onSelectRecommendation,
		};
		const view = render(<AutomationPageView {...props} hasTasks={false} />);
		await user.click(screen.getByRole("button", { name: /Review project/ }));
		expect(onSelectRecommendation).toHaveBeenCalledWith("review");
		await user.click(screen.getByRole("button", { name: "New task" }));
		expect(onNewTask).toHaveBeenCalledOnce();
		view.rerender(<AutomationPageView {...props} hasTasks />);
		expect(screen.getByText("Saved task")).toBeTruthy();
		expect(screen.queryByText("Review project")).toBeNull();
	});
	it("keeps each task action separate from opening its history", async () => {
		const user = userEvent.setup();
		const onSelectTask = vi.fn(),
			onRunTask = vi.fn(),
			onEditTask = vi.fn(),
			onToggleTask = vi.fn(),
			onDeleteTask = vi.fn();
		render(
			<TaskListView
				items={[
					{
						id: "one",
						name: "Project review",
						prompt: "Review changes",
						cron: "0 9 * * 1",
						enabled: true,
						executionModeLabel: "Ask first",
						isOnce: false,
						isRunning: false,
						isSelected: false,
						lastRunLabel: "Not run",
						lastRunStatus: null,
						scheduleLabel: "Monday 9:00",
						statusLabel: "Ready",
					},
				]}
				labels={{
					delete: "Delete",
					edit: "Edit",
					enable: "Enable",
					failed: "Failed",
					once: "Once",
					pause: "Pause",
					runNow: "Run now",
					success: "Success",
				}}
				{...{ onSelectTask, onRunTask, onEditTask, onToggleTask, onDeleteTask }}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Run now" }));
		await user.click(screen.getByRole("button", { name: "Edit" }));
		await user.click(screen.getByRole("button", { name: "Pause" }));
		await user.click(screen.getByRole("button", { name: "Delete" }));
		expect(onRunTask).toHaveBeenCalledWith("one");
		expect(onEditTask).toHaveBeenCalledWith("one");
		expect(onToggleTask).toHaveBeenCalledWith("one");
		expect(onDeleteTask).toHaveBeenCalledWith("one");
		expect(onSelectTask).not.toHaveBeenCalled();
		await user.click(screen.getByText("Project review"));
		expect(onSelectTask).toHaveBeenCalledWith("one");
	});
	it("retains both empty-state and header batch creation entry points", async () => {
		const user = userEvent.setup(),
			onNewProject = vi.fn();
		render(
			<BatchTasksPageView
				dialog={null}
				labels={{
					title: "Batch tasks",
					subtitle: "Manage work",
					newProject: "New project",
					emptyTitle: "Start a project",
					emptyDesc: "Add tasks",
					emptyAction: "Create first project",
					statsTotal: "Total",
					statsRunning: "Running",
					statsCompleted: "Done",
					statsFailed: "Failed",
				}}
				list={null}
				onNewProject={onNewProject}
				projectCount={0}
				stats={{ total: 0, running: 0, completed: 0, failed: 0 }}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "New project" }));
		await user.click(screen.getByRole("button", { name: "Create first project" }));
		expect(onNewProject).toHaveBeenCalledTimes(2);
	});
	it("keeps settings child navigation and its current-page semantics", async () => {
		const user = userEvent.setup(),
			onSelectTab = vi.fn(),
			onSelectChild = vi.fn();
		render(
			<SettingsSidebarView
				activeTab="appearance"
				activeChildKey="colors"
				betaBadgeLabel="Beta"
				narrow={false}
				title="Settings"
				tabs={[
					{
						key: "appearance",
						label: "Appearance",
						icon: "icon-[solar--palette-linear]",
						children: [{ key: "colors", label: "Colors", icon: "icon-[solar--palette-linear]" }],
					},
				]}
				{...{ onSelectTab, onSelectChild }}
			/>,
		);
		expect(screen.getByRole("button", { name: "Colors" }).getAttribute("aria-current")).toBe("page");
		await user.click(screen.getByRole("button", { name: "Colors" }));
		expect(onSelectChild).toHaveBeenCalledWith("colors");
		await user.click(screen.getByRole("button", { name: "Appearance" }));
		expect(onSelectTab).toHaveBeenCalledWith("appearance");
	});
});
