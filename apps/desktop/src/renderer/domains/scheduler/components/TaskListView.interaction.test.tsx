// @vitest-environment jsdom

import { TaskListView } from "@vetta-org/theme-ui/scheduler";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

afterEach(cleanup);

it("keeps human-readable timing and task selection without exposing cron in the list", () => {
	const select = vi.fn();
	render(
		<TaskListView
			items={[
				{
					id: "task",
					name: "Morning report",
					subtitle: "Weekdays 09:00",
					tone: "active",
					isSelected: true,
				},
			]}
			onSelectTask={select}
		/>,
	);
	expect(screen.getByText("Weekdays 09:00")).toBeTruthy();
	expect(screen.getByRole("button", { name: /Morning report/ }).getAttribute("aria-current")).toBe("true");
	expect(screen.queryByText("0 9 * * 1-5")).toBeNull();

	expect(select).not.toHaveBeenCalled();
	fireEvent.click(screen.getByText("Morning report"));
	expect(select).toHaveBeenCalledWith("task");
});
