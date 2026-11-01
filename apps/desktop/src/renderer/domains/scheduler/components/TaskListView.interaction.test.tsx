// @vitest-environment jsdom

import { TaskListView } from "@vetta-org/theme-ui/scheduler";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);

it("keeps human-readable timing and explicit task actions without exposing cron in the card body", () => {
	const select = vi.fn();
	const run = vi.fn();
	const edit = vi.fn();
	const toggle = vi.fn();
	const remove = vi.fn();
	render(
		<TaskListView
			items={[
				{
					id: "task",
					name: "Morning report",
					prompt: "Summarize my tasks",
					cron: "0 9 * * 1-5",
					scheduleLabel: "Weekdays 09:00",
					enabled: true,
					isOnce: false,
					isRunning: false,
					isSelected: true,
					executionModeLabel: "Ask",
					lastRunLabel: "Yesterday",
					lastRunStatus: "success",
					statusLabel: "Enabled",
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
			onDeleteTask={remove}
			onEditTask={edit}
			onRunTask={run}
			onSelectTask={select}
			onToggleTask={toggle}
		/>,
	);
	expect(screen.getByText("Weekdays 09:00")).toBeTruthy();
	expect(screen.getByTitle("0 9 * * 1-5")).toBeTruthy();
	expect(screen.queryByText("0 9 * * 1-5")).toBeNull();
	for (const label of ["Run now", "Pause", "Edit", "Delete"])
		fireEvent.click(screen.getByRole("button", { name: label }));
	for (const action of [run, toggle, edit, remove]) expect(action).toHaveBeenCalledWith("task");
	expect(select).not.toHaveBeenCalled();
	fireEvent.click(screen.getByText("Morning report"));
	expect(select).toHaveBeenCalledWith("task");
});
