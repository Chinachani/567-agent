// @vitest-environment jsdom
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { AtPanelView } from "@vetta-org/theme-ui/chat";
import { expect, it, vi } from "vitest";

it("keeps all reference candidates reachable, fades only overflow, and leaves the header outside the scroller", () => {
	const select = vi.fn();
	const entries = Array.from({ length: 100 }, (_, index) => ({
		path: `/files/${index}`,
		name: `File ${index}`,
		isDirectory: false,
		index,
		active: false,
		icon: "icon-[solar--document-linear]",
	}));
	render(
		<AtPanelView
			open
			loading={false}
			normalizedFilter=""
			canGoUp={false}
			goUpActive={false}
			entries={entries}
			labels={{
				header: "References",
				headingMeta: "100 files",
				loading: "Loading",
				noResults: "No results",
				emptyDirectory: "Empty",
				goUp: "Go up",
				enterDirectory: "Enter",
			}}
			panelRef={createRef()}
			onGoUp={vi.fn()}
			onHoverIndex={vi.fn()}
			onEntryClick={select}
		/>,
	);
	const scroll = screen.getByRole("region", { name: "References" });
	expect(scroll.contains(screen.getByText("100 files"))).toBe(false);
	Object.defineProperties(scroll, {
		scrollHeight: { configurable: true, value: 1200 },
		clientHeight: { configurable: true, value: 200 },
	});
	fireEvent.scroll(scroll);
	expect(scroll.style.maskImage).toContain("linear-gradient");
	scroll.scrollTop = 1000;
	fireEvent.scroll(scroll);
	expect(scroll.style.maskImage).toBe("");
	fireEvent.click(screen.getByRole("button", { name: "File 99" }));
	expect(select).toHaveBeenCalledWith(entries[99]);
});
