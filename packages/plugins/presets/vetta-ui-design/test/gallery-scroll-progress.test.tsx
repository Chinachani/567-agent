import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GalleryScrollProgress } from "../src/gallery/GalleryScrollProgress";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let scrollElement: HTMLDivElement;
let root: Root;
const scrollRef = { current: null as HTMLDivElement | null };
const contentRef = { current: null as HTMLDivElement | null };

beforeEach(() => {
	host = document.createElement("div");
	scrollElement = document.createElement("div");
	scrollElement.append(document.createElement("div"));
	document.body.append(host, scrollElement);
	Object.defineProperties(scrollElement, {
		scrollHeight: { configurable: true, value: 1000 },
		clientHeight: { configurable: true, value: 500 },
	});
	scrollRef.current = scrollElement;
	contentRef.current = scrollElement.firstElementChild as HTMLDivElement;
	root = createRoot(host);
	act(() =>
		root.render(
			<GalleryScrollProgress
				scrollRef={scrollRef}
				contentRef={contentRef}
				label="page scrollbar"
				controlsId="design-gallery-scroll"
			/>,
		),
	);
	const track = host.querySelector<HTMLElement>("[role='scrollbar']") as HTMLDivElement;
	Object.defineProperty(track, "clientHeight", { configurable: true, value: 200 });
	track.getBoundingClientRect = () => ({
		x: 0,
		y: 100,
		width: 12,
		height: 200,
		top: 100,
		bottom: 300,
		left: 0,
		right: 12,
		toJSON: () => ({}),
	});
	act(() => window.dispatchEvent(new Event("resize")));
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	scrollElement.remove();
	scrollRef.current = null;
	contentRef.current = null;
});

function pointerEvent(type: string, pointerId: number, clientY: number): MouseEvent {
	const event = new MouseEvent(type, { bubbles: true, clientY });
	Object.defineProperty(event, "pointerId", { value: pointerId });
	return event;
}

describe("GalleryScrollProgress", () => {
	it("exposes the gallery scroll position as an accessible scrollbar", () => {
		scrollElement.scrollTop = 125;
		act(() => scrollElement.dispatchEvent(new Event("scroll")));
		const scrollbar = host.querySelector('[role="scrollbar"]');
		expect(scrollbar?.getAttribute("aria-valuenow")).toBe("125");
		expect(scrollbar?.getAttribute("aria-valuemax")).toBe("500");
		expect(scrollbar?.getAttribute("aria-controls")).toBe("design-gallery-scroll");
	});

	it("lets users drag the thumb and click the track to navigate", () => {
		const scrollbar = host.querySelector<HTMLElement>('[role="scrollbar"]');
		expect(scrollbar).not.toBeNull();
		expect(scrollbar?.querySelector<HTMLElement>("[data-scroll-thumb]")?.style.height).toBe("100px");
		act(() => scrollbar?.dispatchEvent(pointerEvent("pointerdown", 1, 200)));
		expect(scrollElement.scrollTop).toBe(250);
		expect(scrollbar?.querySelector("[data-scroll-thumb]")?.className).toContain("w-1.5 bg-primary");
		act(() => scrollbar?.dispatchEvent(pointerEvent("pointermove", 1, 225)));
		expect(scrollElement.scrollTop).toBe(375);
		act(() => scrollbar?.dispatchEvent(pointerEvent("pointerup", 1, 225)));
		expect(scrollbar?.querySelector("[data-scroll-thumb]")?.className).not.toContain("w-1.5 bg-primary");
	});

	it("supports arrow, page, home and end keyboard navigation", () => {
		const scrollbar = host.querySelector<HTMLElement>('[role="scrollbar"]');
		scrollbar?.focus();
		act(() => scrollbar?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
		expect(scrollElement.scrollTop).toBe(40);
		act(() => scrollbar?.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })));
		expect(scrollElement.scrollTop).toBe(500);
		act(() => scrollbar?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
		expect(scrollElement.scrollTop).toBe(0);
		act(() => scrollbar?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
		expect(scrollElement.scrollTop).toBe(500);
	});
});
