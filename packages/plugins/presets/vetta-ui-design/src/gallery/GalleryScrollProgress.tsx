import { useEffect, useState, type RefObject } from "react";

/** Scroll updates stay local to this small component instead of rerendering the card grid. */
export function GalleryScrollProgress({
	scrollRef,
	contentRef,
	label,
}: {
	scrollRef: RefObject<HTMLElement | null>;
	contentRef: RefObject<HTMLElement | null>;
	label: string;
}) {
	const [progress, setProgress] = useState(0);

	useEffect(() => {
		const element = scrollRef.current;
		const content = contentRef.current;
		if (!element) return;
		const update = (): void => {
			const maxScroll = element.scrollHeight - element.clientHeight;
			setProgress(maxScroll > 0 ? Math.min(1, Math.max(0, element.scrollTop / maxScroll)) : 0);
		};
		element.addEventListener("scroll", update, { passive: true });
		window.addEventListener("resize", update);
		const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
		resizeObserver?.observe(element);
		if (content) resizeObserver?.observe(content);
		update();
		return () => {
			element.removeEventListener("scroll", update);
			window.removeEventListener("resize", update);
			resizeObserver?.disconnect();
		};
	}, [contentRef, scrollRef]);

	return (
		<div
			role="progressbar"
			aria-label={label}
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress * 100)}
			className="pointer-events-none absolute bottom-3 right-1.5 top-3 z-20 w-1 rounded-full bg-border/60"
		>
			<div
				className="w-full rounded-full bg-primary transition-[height] duration-150"
				style={{ height: `${progress * 100}%` }}
			/>
		</div>
	);
}
