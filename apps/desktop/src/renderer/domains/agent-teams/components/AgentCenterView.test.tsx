// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentCenterView, type AgentCenterViewProps } from "./AgentCenterView";

function props(overrides: Partial<AgentCenterViewProps> = {}): AgentCenterViewProps {
	return {
		tab: "experts",
		title: "Experts",
		subtitle: "Choose an expert",
		tabs: [
			{ id: "experts", label: "Experts" },
			{ id: "collaboration", label: "Collaboration" },
		],
		experts: [
			{
				id: "alpha",
				name: "Alpha",
				description: "Build software",
				category: "development",
				categoryLabel: "Development",
				sourceLabel: "Built in",
				abilityLabel: "All abilities",
				workflow: ["Plan", "Build", "Review"],
			},
		],
		projects: [{ cwd: "/project", name: "Project", sessionLabel: "2 sessions" }],
		categories: [{ id: "development", label: "Development" }],
		labels: {
			create: "Create expert",
			use: "Use",
			copy: "Copy",
			details: "Details",
			expertsEmpty: "No experts",
			collaborationHint: "Collaborate in projects",
			projectsEmpty: "No projects",
			newProject: "Start a project",
			openProject: "Open collaboration",
			expertSearch: "Search experts",
			projectSearch: "Search projects",
			category: "Category",
			allCategories: "All categories",
			noMatches: "No matches",
			clearFilters: "Clear filters",
			pagination: {
				previous: "Previous",
				next: "Next",
				summary: (page, pages, total) => `${page}/${pages}: ${total}`,
			},
		},
		onTabChange: vi.fn(),
		onCreate: vi.fn(),
		onUse: vi.fn(),
		onCopy: vi.fn(),
		onDetails: vi.fn(),
		onProject: vi.fn(),
		onNewProject: vi.fn(),
		...overrides,
	};
}

describe("AgentCenterView", () => {
	it("opens the expert details from its own action", async () => {
		const view = props();
		render(<AgentCenterView {...view} />);
		await userEvent.setup().click(screen.getByRole("button", { name: "Details · Alpha" }));
		expect(view.onDetails).toHaveBeenCalledWith("alpha");
	});
	it("uses an expert without also opening details", async () => {
		const view = props();
		render(<AgentCenterView {...view} />);
		await userEvent.setup().click(screen.getByRole("button", { name: "Use · Alpha" }));
		expect(view.onUse).toHaveBeenCalledWith("alpha");
		expect(view.onDetails).not.toHaveBeenCalled();
	});
	it("copies an expert independently of using it", async () => {
		const view = props();
		render(<AgentCenterView {...view} />);
		await userEvent.setup().click(screen.getByRole("button", { name: "Copy · Alpha" }));
		expect(view.onCopy).toHaveBeenCalledWith("alpha");
		expect(view.onUse).not.toHaveBeenCalled();
	});
	it("opens the selected project collaboration", async () => {
		const view = props({ tab: "collaboration" });
		render(<AgentCenterView {...view} />);
		await userEvent.setup().click(screen.getByRole("button", { name: "Open collaboration" }));
		expect(view.onProject).toHaveBeenCalledWith("/project");
	});
	it("switches sections through the navigation contract", async () => {
		const view = props();
		render(<AgentCenterView {...view} />);
		await userEvent.setup().click(screen.getByRole("button", { name: "Collaboration" }));
		expect(view.onTabChange).toHaveBeenCalledWith("collaboration");
	});
	it("offers a project entry when no project exists", async () => {
		const view = props({ tab: "collaboration", projects: [] });
		render(<AgentCenterView {...view} />);
		expect(screen.getByText("No projects")).toBeDefined();
		await userEvent.setup().click(screen.getByRole("button", { name: "Start a project" }));
		expect(view.onNewProject).toHaveBeenCalledOnce();
	});
	it("opens a fresh expert draft from the expert section", async () => {
		const view = props();
		render(<AgentCenterView {...view} />);
		await userEvent.setup().click(screen.getByRole("button", { name: "Create expert" }));
		expect(view.onCreate).toHaveBeenCalledOnce();
	});
	it("shows the real prompt workflow preview and an empty catalog state", () => {
		const view = render(<AgentCenterView {...props()} />);
		expect(screen.getByText("Plan → Build → Review")).toBeDefined();
		view.rerender(<AgentCenterView {...props({ experts: [] })} />);
		expect(screen.getByText("No experts")).toBeDefined();
	});
});
