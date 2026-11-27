import { NewSessionQuickStart } from "./NewSessionQuickStart";
import { activeComposerCommandsAtom, inputValueAtom } from "@shared/store/atoms";
import { createStore, Provider } from "jotai";
// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type AgentProfile, createAgentTeamFixture } from "@567agent/agent-team";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAgentTeamDirectoryForTest } from "./agent-team-directory";
import { NewSessionAgentSelector } from "./NewSessionAgentSelector";
import { agentTargetKey, type NewSessionTargetKey } from "./target";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string, values?: Record<string, number>) =>
			key === "newSession.agentSelector.memberCount" ? `${values?.count ?? 0} members` : key,
	}),
}));

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
afterEach(cleanup);

describe("NewSessionAgentSelector", () => {
	const document = createAgentTeamFixture();
	const team = document.teams[0];
	const agent = document.agents.find((candidate) => candidate.name === "Researcher");
	if (!team || !agent) throw new Error("missing Agent Team fixture");

	function mockCatalog(next = document): void {
		Object.defineProperty(window, "vetta", {
			configurable: true,
			value: { agentTeams: { list: vi.fn(async () => next), onChanged: () => () => {} } },
		});
	}

	beforeEach(() => {
		resetAgentTeamDirectoryForTest();
		mockCatalog();
	});

	function Harness({ onSelect }: { onSelect: (key: NewSessionTargetKey | null) => void }): JSX.Element {
		const [selectedKey, setSelectedKey] = useState<NewSessionTargetKey | null>(null);
		return (
			<NewSessionAgentSelector
				selectedKey={selectedKey}
				onSelect={(targetKey) => {
					setSelectedKey(targetKey);
					onSelect(targetKey);
				}}
			/>
		);
	}

	it("opens from the keyboard with one native trigger and no nested avatar button", async () => {
		const user = userEvent.setup();
		const onSelect = vi.fn();
		render(<Harness onSelect={onSelect} />);
		const trigger = screen.getByRole("button", { name: "newSession.agentSelector.pickTitle" });
		expect(trigger.tagName).toBe("BUTTON");
		expect(trigger.querySelector("button")).toBeNull();
		trigger.focus();
		await user.keyboard("{Enter}");
		await user.click(await screen.findByRole("option", { name: new RegExp(agent.name) }));
		expect(onSelect).toHaveBeenCalledWith(agentTargetKey(agent.id));
	});

	it("excludes retired teams from new conversations", async () => {
		const user = userEvent.setup();
		render(<Harness onSelect={vi.fn()} />);
		await user.click(screen.getByRole("button", { name: "newSession.agentSelector.pickTitle" }));
		await screen.findByRole("option", { name: new RegExp(agent.name) });
		expect(screen.queryByRole("option", { name: new RegExp(team.name) })).toBeNull();
	});

	it("picks a single agent and shows only that agent's avatar on the trigger", async () => {
		const onSelect = vi.fn();
		const user = userEvent.setup();
		render(<Harness onSelect={onSelect} />);

		await user.click(screen.getByRole("button", { name: "newSession.agentSelector.pickTitle" }));

		const option = await screen.findByRole("option", { name: new RegExp(agent.name) });
		await user.click(option);
		expect(onSelect).toHaveBeenCalledWith(agentTargetKey(agent.id));

		const selectedTrigger = screen.getByRole("button", { name: "newSession.agentSelector.switchTitle" });
		expect(within(selectedTrigger).getByText(agent.name)).toBeDefined();
		expect(selectedTrigger.querySelectorAll('[data-agent-avatar="true"]')).toHaveLength(1);
	});

	it("labels the expert group without a team group", async () => {
		const user = userEvent.setup();
		render(<Harness onSelect={vi.fn()} />);

		await user.click(screen.getByRole("button", { name: "newSession.agentSelector.pickTitle" }));

		await screen.findByRole("listbox", { name: "newSession.agentSelector.groupAgents" });
		expect(screen.queryByRole("listbox", { name: "newSession.agentSelector.groupTeams" })).toBeNull();
		expect(screen.getByRole("listbox", { name: "newSession.agentSelector.groupAgents" })).toBeDefined();
	});

	it("filters experts with one query", async () => {
		const user = userEvent.setup();
		// 搜索框仅在目录条目超过阈值时出现。
		const extra: AgentProfile[] = Array.from({ length: 6 }, (_, i) => ({
			...agent,
			id: `extra-${i}`,
			name: `Translate ${i}`,
		}));
		mockCatalog({ ...document, agents: [...document.agents, ...extra] });
		render(<Harness onSelect={vi.fn()} />);

		await user.click(screen.getByRole("button", { name: "newSession.agentSelector.pickTitle" }));
		await screen.findByRole("option", { name: new RegExp(agent.name) });
		await user.type(screen.getByPlaceholderText("newSession.agentSelector.searchPlaceholder"), agent.name);

		expect(screen.queryByRole("listbox", { name: "newSession.agentSelector.groupTeams" })).toBeNull();
		expect(screen.getByRole("listbox", { name: "newSession.agentSelector.groupAgents" })).toBeDefined();
	});

	it("hides team-scoped profile copies so the list shows no shadow duplicates", async () => {
		const user = userEvent.setup();
		const copied: AgentProfile = { ...agent, id: "copy-1", scope: { kind: "team", teamId: team.id } };
		mockCatalog({ ...document, agents: [...document.agents, copied] });
		render(<Harness onSelect={vi.fn()} />);

		await user.click(screen.getByRole("button", { name: "newSession.agentSelector.pickTitle" }));
		await screen.findByRole("option", { name: new RegExp(agent.name) });

		// 团队 `copy` 绑定的副本是团队私有的，摆进选择器就是一堆同名条目。
		expect(screen.getAllByRole("option", { name: new RegExp(agent.name) })).toHaveLength(1);
	});
	it("quick-start opens the expert picker, preserves the draft and reaches composer and pairing actions", async () => {
		const user = userEvent.setup();
		const store = createStore();
		const openCommands = vi.fn();
		const openReferences = vi.fn();
		store.set(inputValueAtom, "Keep this draft");
		store.set(activeComposerCommandsAtom, {
			focus: () => {},
			abort: () => {},
			isBusy: () => false,
			openCommands,
			openReferences,
		});
		const selected = vi.fn();
		function Start() {
			const [picker, setPicker] = useState<{ open: boolean }>({
				open: false,
			});
			return (
				<>
					<NewSessionAgentSelector
						selectedKey={null}
						onSelect={selected}
						picker={{ ...picker, onOpenChange: (open) => setPicker({ open }) }}
					/>
					<NewSessionQuickStart onOpenExperts={() => setPicker({ open: true })} />
				</>
			);
		}
		render(
			<Provider store={store}>
				<Start />
			</Provider>,
		);
		await user.click(screen.getByRole("button", { name: "newSession.quickStart.experts" }));
		expect(await screen.findByRole("listbox", { name: "newSession.agentSelector.groupAgents" })).toBeTruthy();
		expect(screen.queryByRole("listbox", { name: "newSession.agentSelector.groupTeams" })).toBeNull();
		await user.click(await screen.findByRole("option", { name: new RegExp(agent.name) }));
		expect(selected).toHaveBeenCalledWith(agentTargetKey(agent.id));
		await user.click(screen.getByRole("button", { name: "newSession.quickStart.commands" }));
		await user.click(screen.getByRole("button", { name: "newSession.quickStart.references" }));
		expect(openCommands).toHaveBeenCalledOnce();
		expect(openReferences).toHaveBeenCalledOnce();
		expect(store.get(inputValueAtom)).toBe("Keep this draft");
		await user.click(screen.getByRole("button", { name: "newSession.quickStart.pairing" }));
		expect(navigate).toHaveBeenCalledWith({ to: "/settings/$tab", params: { tab: "remote" } });
	});
});
