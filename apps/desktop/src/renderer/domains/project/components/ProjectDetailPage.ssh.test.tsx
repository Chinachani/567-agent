// @vitest-environment jsdom
import { initI18n } from "@shared/i18n";
import { projectsAtom } from "@shared/store/atoms";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { ProjectDetailPage } from "./ProjectDetailPage";

const routing = vi.hoisted(() => ({ cwd: "", navigate: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => routing.navigate,
	useParams: () => ({ cwd: routing.cwd }),
}));

vi.mock("@domains/activity-panel/components/ActivityPanel", () => ({ CurrentScenarioActivityPanel: () => null }));

afterEach(() => vi.unstubAllGlobals());

it("opens remote project rules and starts a new session without loading local collaboration", async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	const cwd = "ssh://host-id/home/dev/remote project";
	routing.cwd = encodeURIComponent(cwd);
	const readCollaboration = vi.fn(async () => {
		throw new Error("Invalid project directory");
	});
	const onCollaborationChanged = vi.fn(() => () => {});
	const readFile = vi.fn(async () => ({ content: "# Remote project rules" }));
	vi.stubGlobal("agent567", {
		project: { readCollaboration, onCollaborationChanged },
		fs: { readFile, stat: vi.fn(async () => null) },
	});
	const store = createStore();
	store.set(projectsAtom, [{ cwd, name: "Remote project", isDefault: false, type: "normal", sessionCount: 0 }]);
	render(
		<Provider store={store}>
			<ProjectDetailPage />
		</Provider>,
	);
	const user = userEvent.setup();
	expect(await screen.findByDisplayValue("# Remote project rules")).toBeTruthy();
	expect(readFile).toHaveBeenCalledWith(`${cwd}/AGENTS.md`);
	await user.click(screen.getByRole("button", { name: "新会话" }));
	expect(routing.navigate).toHaveBeenCalledWith({ to: "/new-session", search: { cwd } });
	expect(screen.queryByRole("tab", { name: "协作" })).toBeNull();
	expect(screen.queryByText("Invalid project directory")).toBeNull();
	expect(readCollaboration).not.toHaveBeenCalled();
	expect(onCollaborationChanged).not.toHaveBeenCalled();
});
