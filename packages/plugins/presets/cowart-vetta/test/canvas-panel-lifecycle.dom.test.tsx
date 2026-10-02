// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	activityTab: { cwd: "/workspace/first" } as { cwd: string } | null,
	mounts: 0,
	unmounts: 0,
}));

vi.mock("@vetta-org/plugin-sdk", () => ({
	useTranslation: () => ({ t: (key: string) => key }),
	useActivityTab: () => state.activityTab,
	useActiveConversation: () => null,
}));

vi.mock("../src/pluginContext", () => ({ getPluginContext: () => ({}) }));

vi.mock("../src/vettaCowartBridge", () => ({
	installBridgeFromPluginContext: vi.fn(() => vi.fn()),
}));

vi.mock("../canvas/App.jsx", async () => {
	const React = await import("react");
	return {
		default: function MockCowartApp() {
			React.useEffect(() => {
				state.mounts += 1;
				return () => {
					state.unmounts += 1;
				};
			}, []);
			return React.createElement("div", { "data-testid": "cowart-canvas" });
		},
	};
});

import { CanvasPanel } from "../src/CanvasPanel";

afterEach(() => {
	cleanup();
	state.activityTab = { cwd: "/workspace/first" };
	state.mounts = 0;
	state.unmounts = 0;
});

describe("Cowart canvas workspace lifecycle", () => {
	it("disposes the old editor and mounts a fresh one when the active workspace changes", async () => {
		const view = render(<CanvasPanel />);
		await screen.findByTestId("cowart-canvas");
		await waitFor(() => expect(state.mounts).toBe(1));

		state.activityTab = { cwd: "/workspace/second" };
		view.rerender(<CanvasPanel />);

		await waitFor(() => {
			expect(state.unmounts).toBe(1);
			expect(state.mounts).toBe(2);
		});
	});
});
