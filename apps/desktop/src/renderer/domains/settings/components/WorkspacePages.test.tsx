// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationPageView, TaskListView } from "@vetta-org/theme-ui/scheduler";
import { BatchTasksPageView } from "@vetta-org/theme-ui/batch-tasks";
import { SettingsSidebarView } from "@vetta-org/theme-ui/settings";

const detail = vi.hoisted(() => ({ run: vi.fn(), toggle: vi.fn(), remove: vi.fn(), save: vi.fn() }));
vi.mock("../../scheduler/hooks/useAutomationDetailModel", () => ({
	useAutomationDetailModel: () => ({
		mode: "edit",
		taskId: "one",
		tone: "active",
		statusLabel: "Ready",
		enabled: true,
		running: false,
		dirty: true,
		canSubmit: true,
		canOpenChat: false,
		error: null,
		onRunNow: detail.run,
		onToggleEnabled: detail.toggle,
		onDelete: detail.remove,
		onSubmit: detail.save,
		onDiscard: vi.fn(),
		onChange: vi.fn(),
	}),
}));
vi.mock("../../scheduler/components/SchedulerTaskFields", () => ({
	SchedulerTaskFields: () => <p>Edit project review</p>,
}));
vi.mock("../../scheduler/components/ExecutionHistory", () => ({ ExecutionHistory: () => <p>Execution history</p> }));
import { AutomationDetailPane } from "../../scheduler/components/AutomationDetailPane";
import { i18n } from "@shared/i18n";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("workspace page actions after the layout redesign", () => {
	it("lets users start from a template or create a task, then retains the populated list", async () => {
		const user = userEvent.setup();
		const onNewTask = vi.fn(),
			onSelectRecommendation = vi.fn();
		const props = {
			labels: {
				title: "Automation",
				subtitle: "Work on a schedule",
				create: "New task",
				searchPlaceholder: "Search tasks",
				recommendTitle: "Start from a template",
			},
			onCreate: onNewTask,
			filters: [{ key: "all", label: "All" }],
			activeFilter: "all",
			onFilterChange: vi.fn(),
			searchValue: "",
			onSearchChange: vi.fn(),
			list: <p>Saved task</p>,
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
		const view = render(<AutomationPageView {...props} />);
		await user.click(screen.getByRole("button", { name: /Review project/ }));
		expect(onSelectRecommendation).toHaveBeenCalledWith("review");
		await user.click(screen.getByRole("button", { name: "New task" }));
		expect(onNewTask).toHaveBeenCalledOnce();
		view.rerender(<AutomationPageView {...props} recommendations={undefined} />);
		expect(screen.getByText("Saved task")).toBeTruthy();
		expect(screen.queryByText("Review project")).toBeNull();
	});
	it("keeps each task action separate from opening its history", async () => {
		const user = userEvent.setup();
		const onSelectTask = vi.fn();
		render(
			<>
				<TaskListView
					items={[
						{ id: "one", name: "Project review", subtitle: "Monday 9:00", tone: "active", isSelected: false },
					]}
					onSelectTask={onSelectTask}
				/>
				<AutomationDetailPane
					pane={{
						kind: "task",
						task: {
							id: "one",
							name: "Project review",
							prompt: "Review",
							schedule: { kind: "daily", hour: 9, minute: 0 },
							runTarget: { mode: "new-session", projectCwd: "/project" },
							enabled: true,
							createdAt: 1,
							updatedAt: 1,
							lastRunAt: null,
							lastRunStatus: null,
						},
					}}
					onClose={vi.fn()}
					onCreated={vi.fn()}
				/>
			</>,
		);
		await user.click(screen.getByRole("button", { name: i18n.t("automation:detail.runNow") }));
		await user.click(screen.getByRole("button", { name: i18n.t("automation:detail.pause") }));
		await user.click(screen.getByRole("button", { name: i18n.t("automation:detail.save") }));
		await user.click(screen.getByRole("button", { name: i18n.t("automation:detail.more") }));
		await user.click(screen.getByRole("menuitem", { name: i18n.t("automation:detail.delete") }));
		for (const action of [detail.run, detail.toggle, detail.save, detail.remove])
			expect(action).toHaveBeenCalledOnce();
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
	it("keeps flat settings navigation and its current-page semantics", async () => {
		const user = userEvent.setup(),
			onSelectTab = vi.fn();
		render(
			<SettingsSidebarView
				activeTab="colors"
				betaBadgeLabel="Beta"
				narrow={false}
				title="Settings"
				tabs={[
					{
						key: "appearance",
						label: "Appearance",
						icon: "icon-[solar--palette-linear]",
					},
					{ key: "colors", label: "Colors", icon: "icon-[solar--palette-linear]" },
				]}
				{...{ onSelectTab }}
			/>,
		);
		expect(screen.getByRole("button", { name: "Colors" }).getAttribute("aria-current")).toBe("page");
		await user.click(screen.getByRole("button", { name: "Colors" }));
		expect(onSelectTab).toHaveBeenCalledWith("colors");
		await user.click(screen.getByRole("button", { name: "Appearance" }));
		expect(onSelectTab).toHaveBeenCalledWith("appearance");
	});
});
