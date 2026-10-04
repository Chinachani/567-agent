// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	ctx: null as {
		conversation: { createSession: (cwd: string) => Promise<{ cwd: string; sessionPath: string }> };
		fs: { createDirectory: (path: string) => Promise<void> };
		ui: { openActivityTab: (id: string, options: { cwd: string; width: "max" }) => void };
		fileExplorer: { getWorkspaceRoots: () => Array<{ path: string }> };
		official: { sessions: { open: (input: { cwd: string; sessionPath: string }) => Promise<void> } };
	} | null,
	conversation: null as { cwd: string | null } | null,
}));

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	useActiveConversation: () => state.conversation,
}));

vi.mock("../src/pluginContext", () => ({ getPluginContext: () => state.ctx }));

import { CanvasWorkspaceLauncher } from "../src/CanvasWorkspaceLauncher";

afterEach(() => {
	cleanup();
	state.ctx = null;
	state.conversation = null;
});

describe("Cowart canvas sidebar entry", () => {
	it("creates a fresh conversation and opens its isolated canvas", async () => {
		const createSession = vi.fn(async (cwd: string) => ({ cwd, sessionPath: "/sessions/new-session.jsonl" }));
		const createDirectory = vi.fn(async () => undefined);
		const openSession = vi.fn(async () => undefined);
		const openActivityTab = vi.fn();
		state.ctx = {
			conversation: { createSession },
			fs: { createDirectory },
			ui: { openActivityTab },
			fileExplorer: { getWorkspaceRoots: () => [{ path: "/workspace/demo" }] },
			official: { sessions: { open: openSession } },
		};

		const view = render(<CanvasWorkspaceLauncher />);

		await waitFor(() => expect(openActivityTab).toHaveBeenCalledWith("canvas", { cwd: "/workspace/demo", width: "max" }));
		expect(createSession).toHaveBeenCalledWith("/workspace/demo", { navigate: false });
		expect(createDirectory).toHaveBeenCalledWith("/workspace/demo/canvas/sessions/new-session");
		expect(openSession).toHaveBeenCalledWith({ cwd: "/workspace/demo", sessionPath: "/sessions/new-session.jsonl" });
		expect(createDirectory.mock.invocationCallOrder[0]).toBeLessThan(openSession.mock.invocationCallOrder[0]);
		expect(openSession.mock.invocationCallOrder[0]).toBeLessThan(openActivityTab.mock.invocationCallOrder[0]);

		state.conversation = { cwd: "/workspace/demo" };
		view.rerender(<CanvasWorkspaceLauncher />);
		expect(createSession).toHaveBeenCalledTimes(1);
	});

	it("shows a useful error when there is no workspace to create the conversation in", async () => {
		state.ctx = {
			conversation: { createSession: vi.fn() },
			fs: { createDirectory: vi.fn() },
			ui: { openActivityTab: vi.fn() },
			fileExplorer: { getWorkspaceRoots: () => [] },
			official: { sessions: { open: vi.fn() } },
		};

		render(<CanvasWorkspaceLauncher />);

		await screen.findByText("launcher.noWorkspace");
		expect(state.ctx.conversation.createSession).not.toHaveBeenCalled();
	});
});
