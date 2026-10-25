// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ launcherLoaded: vi.fn(), panelLoaded: vi.fn() }));
vi.mock("@vetta-org/plugin-sdk", () => ({ definePlugin: (definition: unknown) => definition }));
vi.mock("../src/CanvasWorkspaceLauncher", () => {
	boundary.launcherLoaded();
	return { CanvasWorkspaceLauncher: () => <div>Canvas chooser ready</div> };
});
vi.mock("../src/CanvasPanel", () => {
	boundary.panelLoaded();
	return { CanvasPanel: () => <div>Canvas editor ready</div> };
});
import plugin from "../src/index";
afterEach(cleanup);
it("registers the sidebar before loading UI and loads only the surface the user opens", async () => {
	const registerWorkspaceView = vi.fn((_view: { component: ComponentType }) => {});
	const registerActivityTab = vi.fn((_tab: { component: ComponentType }) => {});
	await Reflect.apply(plugin.activate!, undefined, [
		{ ui: { registerWorkspaceView, registerActivityTab }, agent: { registerTool: vi.fn() } },
	]);
	expect(boundary.launcherLoaded).not.toHaveBeenCalled();
	expect(boundary.panelLoaded).not.toHaveBeenCalled();
	const Launcher = registerWorkspaceView.mock.calls[0][0].component;
	render(<Launcher />);
	expect(await screen.findByText("Canvas chooser ready")).toBeTruthy();
	expect(boundary.launcherLoaded).toHaveBeenCalledOnce();
	expect(boundary.panelLoaded).not.toHaveBeenCalled();
});
