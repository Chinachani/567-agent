import { type RefObject, useEffect } from "react";

/** Capture closes the previous menu even when the next resource owns the bubbling event. */
export function useContextMenuDismiss(ref: RefObject<HTMLElement | null>, close: () => void): void {
	useEffect(() => {
		const outside = (event: MouseEvent) => {
			if (event.target instanceof Node && !ref.current?.contains(event.target)) close();
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") close();
		};
		document.addEventListener("mousedown", outside);
		document.addEventListener("contextmenu", close, true);
		document.addEventListener("keydown", onKeyDown);
		window.addEventListener("blur", close);
		return () => {
			document.removeEventListener("mousedown", outside);
			document.removeEventListener("contextmenu", close, true);
			document.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("blur", close);
		};
	}, [ref, close]);
}
