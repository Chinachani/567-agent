// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { usePanelViewportHeight } from "@vetta-org/theme-ui/chat";
import { expect, it, vi } from "vitest";

it("reserves top space from the anchor, resizes with the viewport, and removes listeners when closed", () => {
	vi.useFakeTimers();
	const clippingParent = document.createElement("div");
	try {
		const anchor = document.createElement("div");
		const panel = document.createElement("div");
		let top = 410;
		anchor.getBoundingClientRect = () => ({ top }) as DOMRect;
		// The panel's own reveal transform must not affect available space.
		panel.getBoundingClientRect = () => ({ bottom: 900 }) as DOMRect;
		Object.defineProperties(panel, {
			offsetParent: { value: anchor },
			offsetTop: { value: -320 },
			offsetHeight: { value: 320 },
		});
		const ref = { current: panel };
		clippingParent.append(anchor);
		anchor.append(panel);
		document.body.append(clippingParent);
		const { rerender, unmount } = renderHook(({ open }) => usePanelViewportHeight(ref, open), {
			initialProps: { open: true },
		});
		expect(panel.style.getPropertyValue("--panel-available-height")).toBe("398px");
		top = 150;
		act(() => {
			window.dispatchEvent(new Event("resize"));
			vi.advanceTimersByTime(32);
		});
		expect(panel.style.getPropertyValue("--panel-available-height")).toBe("138px");
		clippingParent.style.overflowY = "hidden";
		clippingParent.getBoundingClientRect = () => ({ top: 40 }) as DOMRect;
		act(() => {
			window.dispatchEvent(new Event("resize"));
			vi.advanceTimersByTime(32);
		});
		expect(panel.style.getPropertyValue("--panel-available-height")).toBe("98px");
		rerender({ open: false });
		top = 80;
		act(() => {
			window.dispatchEvent(new Event("resize"));
			vi.advanceTimersByTime(32);
		});
		expect(panel.style.getPropertyValue("--panel-available-height")).toBe("98px");
		rerender({ open: true });
		expect(panel.style.getPropertyValue("--panel-available-height")).toBe("28px");
		act(() => window.dispatchEvent(new Event("resize")));
		unmount();
		top = 0;
		act(() => vi.advanceTimersByTime(32));
		expect(panel.style.getPropertyValue("--panel-available-height")).toBe("28px");
	} finally {
		clippingParent.remove();
		vi.useRealTimers();
	}
});
