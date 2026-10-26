// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputBarModel } from "./input-bar/types";
import { InputBar } from "./InputBar";
import type { ComponentType, ReactNode } from "react";
import type { InputBarViewProps } from "./input-bar/types";
import userEvent from "@testing-library/user-event";

const captured = vi.hoisted(() => ({ model: vi.fn(), override: null as ComponentType<InputBarViewProps> | null }));

vi.mock("@vetta-org/theme-sdk", () => ({
	useThemeComponent: (_slot: string, component: unknown) => captured.override ?? component,
}));
vi.mock("./input-bar/InputBarView", () => ({
	InputBarView: ({ model, children }: { model: InputBarModel; children?: ReactNode }) => {
		captured.model(model);
		return <div data-testid="input-bar-view">{children}</div>;
	},
}));

afterEach(() => {
	cleanup();
	captured.model.mockReset();
	captured.override = null;
});

describe("InputBar presentation", () => {
	it.each([false, true])("keeps setup controls usable with a legacy theme override=%s", async (override) => {
		if (override) captured.override = () => <div>Custom input</div>;
		const choose = vi.fn();
		render(
			<InputBar model={{ marker: "new-session" } as unknown as InputBarModel}>
				<button type="button" onClick={choose}>
					Choose project
				</button>
			</InputBar>,
		);
		await userEvent.setup().click(screen.getByRole("button", { name: "Choose project" }));
		expect(choose).toHaveBeenCalledOnce();
		expect(screen.getAllByRole("button", { name: "Choose project" })).toHaveLength(1);
	});

	it("renders the existing themed view from an explicit model", () => {
		const model = { marker: "team" } as unknown as InputBarModel;
		render(<InputBar model={model} />);

		expect(screen.getByTestId("input-bar-view")).toBeTruthy();
		expect(captured.model).toHaveBeenCalledWith(model);
	});
});
