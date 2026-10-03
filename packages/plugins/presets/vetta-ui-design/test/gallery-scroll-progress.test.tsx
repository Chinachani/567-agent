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
	const content = document.createElement("div");
	scrollElement.append(content);
	document.body.append(host, scrollElement);
	Object.defineProperties(scrollElement, {
		scrollHeight: { configurable: true, value: 1000 },
		clientHeight: { configurable: true, value: 500 },
	});
	scrollRef.current = scrollElement;
	contentRef.current = content;
	root = createRoot(host);
	act(() =>
		root.render(<GalleryScrollProgress scrollRef={scrollRef} contentRef={contentRef} label="scroll progress" />),
	);
});

afterEach(() => {
	act(() => root.unmount());
	host.remove();
	scrollElement.remove();
	scrollRef.current = null;
	contentRef.current = null;
});

describe("GalleryScrollProgress", () => {
	it("reflects scroll position without rerendering the gallery", () => {
		scrollElement.scrollTop = 125;
		act(() => scrollElement.dispatchEvent(new Event("scroll")));
		expect(host.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("25");
	});
});
