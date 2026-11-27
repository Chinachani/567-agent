// @vitest-environment jsdom
import { initI18n } from "@shared/i18n";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "i18next";
import { afterEach, expect, it, vi } from "vitest";
import type { ManagedWorktreeInfo } from "@/shared/project-collaboration";
import { ManagedWorktreesDialog } from "./ManagedWorktreesDialog";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@shared/lib/committed-paint", () => ({ waitForCommittedPaint: async () => {} }));

afterEach(() => vi.unstubAllGlobals());

it("shows the running workspace and requires confirmation to remove an idle one", async () => {
	initI18n();
	await i18n.changeLanguage("zh");
	const first: ManagedWorktreeInfo = {
		path: "/trees/first",
		cwd: "/trees/first",
		sessionId: "first",
		sessionPath: "/sessions/first.jsonl",
		baseCommit: "a".repeat(40),
		state: "ok",
		dirty: false,
		inUse: false,
	};
	const second: ManagedWorktreeInfo = {
		...first,
		path: "/trees/second",
		cwd: "/trees/second",
		sessionId: "second",
		sessionPath: "/sessions/second.jsonl",
		inUse: true,
	};
	const readWorktrees = vi.fn(async () => ({ supported: true, worktrees: [first, second] }));
	const removeWorktree = vi.fn(async () => ({ ok: true, snapshot: { supported: true, worktrees: [second] } }));
	vi.stubGlobal("agent567", { project: { readWorktrees, removeWorktree } });
	const user = userEvent.setup();
	render(<ManagedWorktreesDialog cwd="/project" />);
	await user.click(screen.getByRole("button", { name: "独立工作区" }));
	const rows = await screen.findAllByRole("listitem");
	expect(within(rows[1]).getByText("任务进行中")).toBeTruthy();
	expect((within(rows[1]).getByRole("button", { name: "移除工作区" }) as HTMLButtonElement).disabled).toBe(true);
	await user.click(within(rows[0]).getByRole("button", { name: "移除工作区" }));
	expect(removeWorktree).not.toHaveBeenCalled();
	const confirm = screen.getByRole("dialog", { name: "移除工作区" });
	await user.click(within(confirm).getByRole("button", { name: "移除工作区" }));
	expect(removeWorktree).toHaveBeenCalledWith("/project", first.path);
	expect(await screen.findAllByRole("listitem")).toHaveLength(1);
});
