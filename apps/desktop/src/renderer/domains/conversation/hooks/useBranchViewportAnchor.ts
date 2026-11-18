import type { ChatConversationItem } from "@shared/store/atoms";
import { createContext, useCallback, useLayoutEffect, useRef } from "react";
import type { MessageListScrollModel } from "./useMessageListScrollModel";

/** Capture only the selector in this mounted feed. The caller cancels the hold if loading fails. */
export const BranchViewportContext = createContext<((from: string, to: string) => (() => void) | undefined) | null>(
	null,
);

function selector(feed: HTMLElement, entry: string) {
	return feed.querySelector<HTMLElement>(`[data-branch-selector="${CSS.escape(entry)}"]`);
}

export function useBranchViewportAnchor(
	scroll: MessageListScrollModel,
	messages: readonly ChatConversationItem[],
	sessionId: string | null,
) {
	const { scrollerElement: feed, holdReadingPosition, virtuosoRef } = scroll;
	const pending = useRef<{
		target: string;
		top: number;
		started: boolean;
		frame: number;
		cancel: (resume?: boolean) => void;
	} | null>(null);
	const begin = useCallback(
		(from: string, to: string) => {
			pending.current?.cancel();
			if (!feed?.isConnected) return;
			const control = selector(feed, from);
			if (!control) return;
			const rect = control.getBoundingClientRect();
			const viewport = feed.getBoundingClientRect();
			if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return;
			const release = holdReadingPosition();
			const controller = new AbortController();
			const options = { passive: true, capture: true, signal: controller.signal };
			const anchor = { target: to, top: rect.top - viewport.top, started: false, frame: 0, cancel };
			function cancel(resume = false) {
				if (pending.current !== anchor) return;
				pending.current = null;
				controller.abort();
				window.clearTimeout(timer);
				window.cancelAnimationFrame(anchor.frame);
				release(resume);
			}
			const timer = window.setTimeout(() => cancel(true), 15000);
			pending.current = anchor;
			const frame = feed.closest("[data-message-viewport]") ?? feed;
			for (const name of ["wheel", "pointerdown", "touchstart"])
				frame.addEventListener(name, () => cancel(), options);
			window.addEventListener(
				"keydown",
				(event) => {
					if (["PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End", " "].includes(event.key)) cancel();
				},
				options,
			);
			return () => cancel(true);
		},
		[feed, holdReadingPosition],
	);

	useLayoutEffect(() => {
		const anchor = pending.current;
		if (!anchor || anchor.started || !feed) return;
		const index = messages.findIndex((item) => item.kind === "user" && item.entryId === anchor.target);
		if (index === -1) return;
		anchor.started = true;
		if (!selector(feed, anchor.target))
			virtuosoRef.current?.scrollToIndex({ index, align: "start", behavior: "auto" });
		let attempts = 0,
			stableFrames = 0;
		function align() {
			if (!anchor || pending.current !== anchor || !feed) return;
			const control = selector(feed, anchor.target);
			if (control) {
				const delta = control.getBoundingClientRect().top - feed.getBoundingClientRect().top - anchor.top;
				if (Math.abs(delta) >= 1) {
					feed.scrollTop += delta;
					stableFrames = 0;
				} else stableFrames++;
			}
			if (++attempts >= 12 || stableFrames >= 3) anchor.cancel();
			else anchor.frame = window.requestAnimationFrame(align);
		}
		align();
	}, [messages, feed, virtuosoRef]);
	useLayoutEffect(() => {
		void sessionId;
		void feed;
		return () => pending.current?.cancel();
	}, [sessionId, feed]);
	return begin;
}
