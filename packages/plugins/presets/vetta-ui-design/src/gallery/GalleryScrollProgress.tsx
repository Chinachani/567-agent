import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";

interface ScrollMetrics {
	scrollTop: number;
	maxScroll: number;
	clientHeight: number;
	scrollHeight: number;
	trackHeight: number;
}

interface DragState {
	pointerId: number;
	grabOffset: number;
}

const MIN_THUMB_HEIGHT = 28;
const KEYBOARD_SCROLL_STEP = 40;

/** A compact native-scrollbar-like control for the gallery's independently scrolling pane. */
export function GalleryScrollProgress({
	scrollRef,
	contentRef,
	label,
	controlsId,
}: {
	scrollRef: RefObject<HTMLElement | null>;
	contentRef: RefObject<HTMLElement | null>;
	label: string;
	controlsId: string;
}) {
	const trackRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<DragState | null>(null);
	const [dragging, setDragging] = useState(false);
	const [metrics, setMetrics] = useState<ScrollMetrics>({
		scrollTop: 0,
		maxScroll: 0,
		clientHeight: 0,
		scrollHeight: 0,
		trackHeight: 0,
	});

	useEffect(() => {
		const element = scrollRef.current;
		const content = contentRef.current;
		const track = trackRef.current;
		if (!element || !track) return;

		const update = (): void => {
			const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
			const next: ScrollMetrics = {
				scrollTop: Math.min(maxScroll, Math.max(0, element.scrollTop)),
				maxScroll,
				clientHeight: element.clientHeight,
				scrollHeight: element.scrollHeight,
				trackHeight: track.getBoundingClientRect().height || track.clientHeight,
			};
			setMetrics((current) =>
				current.scrollTop === next.scrollTop &&
				current.maxScroll === next.maxScroll &&
				current.clientHeight === next.clientHeight &&
				current.scrollHeight === next.scrollHeight &&
				current.trackHeight === next.trackHeight
					? current
					: next,
			);
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

	const thumbHeight = metrics.scrollHeight > 0
		? Math.min(metrics.trackHeight, Math.max(MIN_THUMB_HEIGHT, metrics.trackHeight * metrics.clientHeight / metrics.scrollHeight))
		: metrics.trackHeight;
	const thumbTravel = Math.max(0, metrics.trackHeight - thumbHeight);
	const thumbTop = metrics.maxScroll > 0 ? (metrics.scrollTop / metrics.maxScroll) * thumbTravel : 0;
	const scrollTo = (scrollTop: number): void => {
		const element = scrollRef.current;
		if (!element) return;
		element.scrollTop = Math.min(metrics.maxScroll, Math.max(0, scrollTop));
		setMetrics((current) => ({ ...current, scrollTop: element.scrollTop }));
	};

	const startDrag = (event: PointerEvent<HTMLDivElement>): void => {
		if (metrics.maxScroll <= 0 || metrics.trackHeight <= 0) return;
		const track = trackRef.current;
		if (!track) return;
		const rect = track.getBoundingClientRect();
		const thumb = track.querySelector<HTMLElement>("[data-scroll-thumb]");
		const thumbRect = thumb?.getBoundingClientRect();
		const targetIsThumb = Boolean(thumb && thumb.contains(event.target as Node));
		const grabOffset = targetIsThumb && thumbRect ? event.clientY - thumbRect.top : thumbHeight / 2;
		if (!targetIsThumb) {
			const nextThumbTop = Math.min(thumbTravel, Math.max(0, event.clientY - rect.top - grabOffset));
			scrollTo(thumbTravel > 0 ? (nextThumbTop / thumbTravel) * metrics.maxScroll : 0);
		}
		dragRef.current = { pointerId: event.pointerId, grabOffset };
		setDragging(true);
		event.currentTarget.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	};

	const moveDrag = (event: PointerEvent<HTMLDivElement>): void => {
		const drag = dragRef.current;
		const track = trackRef.current;
		if (!drag || drag.pointerId !== event.pointerId || !track) return;
		const rect = track.getBoundingClientRect();
		const nextThumbTop = Math.min(thumbTravel, Math.max(0, event.clientY - rect.top - drag.grabOffset));
		scrollTo(thumbTravel > 0 ? (nextThumbTop / thumbTravel) * metrics.maxScroll : 0);
	};

	const stopDrag = (event: PointerEvent<HTMLDivElement>): void => {
		if (dragRef.current?.pointerId !== event.pointerId) return;
		dragRef.current = null;
		setDragging(false);
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture?.(event.pointerId);
		}
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
		let next: number | null = null;
		switch (event.key) {
			case "ArrowUp":
				next = metrics.scrollTop - KEYBOARD_SCROLL_STEP;
				break;
			case "ArrowDown":
				next = metrics.scrollTop + KEYBOARD_SCROLL_STEP;
				break;
			case "PageUp":
				next = metrics.scrollTop - metrics.clientHeight;
				break;
			case "PageDown":
				next = metrics.scrollTop + metrics.clientHeight;
				break;
			case "Home":
				next = 0;
				break;
			case "End":
				next = metrics.maxScroll;
				break;
		}
		if (next === null) return;
		event.preventDefault();
		scrollTo(next);
	};

	const scrollable = metrics.maxScroll > 0;
	return (
		<div
			ref={trackRef}
			role={scrollable ? "scrollbar" : undefined}
			aria-hidden={scrollable ? undefined : true}
			aria-label={scrollable ? label : undefined}
			aria-controls={scrollable ? controlsId : undefined}
			aria-orientation="vertical"
			aria-valuemin={scrollable ? 0 : undefined}
			aria-valuemax={scrollable ? Math.round(metrics.maxScroll) : undefined}
			aria-valuenow={scrollable ? Math.round(metrics.scrollTop) : undefined}
			tabIndex={scrollable ? 0 : -1}
			onKeyDown={onKeyDown}
			onPointerDown={startDrag}
			onPointerMove={moveDrag}
			onPointerUp={stopDrag}
			onPointerCancel={stopDrag}
			className={`absolute bottom-3 right-1.5 top-3 z-40 flex w-3 touch-none items-start justify-center rounded-full outline-none transition-colors hover:bg-border/40 focus-visible:bg-border/50 ${scrollable ? "cursor-pointer" : "pointer-events-none opacity-0"}`}
		>
			<div
				data-scroll-thumb
				className={`w-1 rounded-full bg-primary/75 transition-[background-color,width] duration-150 hover:w-1.5 hover:bg-primary ${dragging ? "w-1.5 bg-primary" : ""}`}
				style={{ height: `${thumbHeight}px`, transform: `translateY(${thumbTop}px)` }}
			/>
		</div>
	);
}
