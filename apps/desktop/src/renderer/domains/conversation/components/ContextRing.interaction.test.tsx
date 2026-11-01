// @vitest-environment jsdom

import { initI18n } from "@shared/i18n";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContextRingView } from "@vetta-org/theme-ui/chat";
import { afterEach, beforeAll, expect, it } from "vitest";
import { ContextRing } from "./ContextRing";

beforeAll(() => initI18n());
afterEach(cleanup);

it("replaces the hover hint with context details on click and restores keyboard focus when closed", async () => {
	const user = userEvent.setup();
	render(
		<ContextRing
			model={{
				percent: 25,
				offset: 30,
				color: "currentColor",
				isCompacting: false,
				tooltip: "Context 25%",
				details: null,
			}}
		/>,
	);
	const trigger = screen.getByRole("button", { name: "Context 25%" });
	fireEvent.mouseOver(trigger.querySelector("svg")!);
	expect(screen.getByRole("tooltip").textContent).toBe("Context 25%");
	await user.click(trigger);
	expect(screen.getByRole("dialog")).toBeTruthy();
	expect(screen.queryByRole("tooltip")).toBeNull();
	await user.keyboard("{Escape}");
	expect(screen.queryByRole("dialog")).toBeNull();
	expect(document.activeElement).toBe(trigger);
	fireEvent.mouseLeave(trigger);
	fireEvent.mouseOver(trigger.querySelector("svg")!);
	expect(screen.getByRole("tooltip").textContent).toBe("Context 25%");
});

it("shows a quiet complete track at zero usage and animates only during compaction", () => {
	const props = { percent: 0, offset: 40, color: "var(--primary)", tooltip: "Context 0%", isCompacting: false };
	const view = render(<ContextRingView {...props} />);
	const svg = view.container.querySelector("svg")!;
	expect(svg.querySelectorAll("circle")).toHaveLength(1);
	expect(svg.querySelector("circle")?.getAttribute("stroke")).toBe("currentColor");
	expect(svg.style.animation).toBe("");
	view.rerender(<ContextRingView {...props} isCompacting />);
	expect(svg.querySelectorAll("circle")).toHaveLength(2);
	expect(svg.style.animation).toContain("context-ring-spin");
});
