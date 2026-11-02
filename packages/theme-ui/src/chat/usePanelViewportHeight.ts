import { type RefObject, useCallback, useLayoutEffect } from "react";

/** Measure the anchored bottom edge without the panel's reveal transform. */
export function usePanelViewportHeight(ref: RefObject<HTMLDivElement | null>, open: boolean): () => void {
	const sync = useCallback(() => {
		const element = ref.current;
		if (!element) return;
		const anchor = element.offsetParent;
		const bottom = anchor
			? anchor.getBoundingClientRect().top + element.offsetTop + element.offsetHeight
			: element.getBoundingClientRect().bottom;
		let top = window.visualViewport?.offsetTop ?? 0;
		// The new-session page scrolls inside the window, so its clipping edge
		// can be lower than the viewport edge (for example below the title bar).
		for (let parent = element.parentElement; parent; parent = parent.parentElement) {
			if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) {
				top = Math.max(top, parent.getBoundingClientRect().top + parent.clientTop);
			}
		}
		const available = Math.max(0, Math.floor(bottom - top - 12));
		element.style.setProperty("--panel-available-height", `${available}px`);
	}, [ref]);

	useLayoutEffect(() => {
		if (!open) return;
		sync();
		let frame = 0;
		const schedule = () => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(sync);
		};
		const anchor = ref.current?.offsetParent ?? ref.current?.parentElement;
		const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
		if (anchor) observer?.observe(anchor);
		window.addEventListener("resize", schedule);
		window.addEventListener("scroll", schedule, true);
		window.visualViewport?.addEventListener("resize", schedule);
		window.visualViewport?.addEventListener("scroll", schedule);
		return () => {
			cancelAnimationFrame(frame);
			observer?.disconnect();
			window.removeEventListener("resize", schedule);
			window.removeEventListener("scroll", schedule, true);
			window.visualViewport?.removeEventListener("resize", schedule);
			window.visualViewport?.removeEventListener("scroll", schedule);
		};
	}, [open, ref, sync]);
	return sync;
}
