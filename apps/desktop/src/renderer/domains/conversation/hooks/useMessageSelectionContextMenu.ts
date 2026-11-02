import { focusInputRequestAtom, inputValueAtom } from "@shared/store/atoms";
import type { MessageSelectionContextMenuViewProps } from "@vetta-org/theme-ui/chat";
import { useSetAtom } from "jotai";
import { type MouseEvent, type RefObject, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { appendInputText } from "../components/input-bar/editor/inputEditorHandle";

const CONTEXT_MENU_WIDTH = 180;
const CONTEXT_MENU_HEIGHT = 80;
const CONTEXT_MENU_VIEWPORT_GAP = 8;

interface MessageSelectionMenuState {
	selectedText: string;
	x: number;
	y: number;
}

function clampPosition(clientX: number, clientY: number): { x: number; y: number } {
	return {
		x: Math.max(
			CONTEXT_MENU_VIEWPORT_GAP,
			Math.min(clientX, window.innerWidth - CONTEXT_MENU_WIDTH - CONTEXT_MENU_VIEWPORT_GAP),
		),
		y: Math.max(
			CONTEXT_MENU_VIEWPORT_GAP,
			Math.min(clientY, window.innerHeight - CONTEXT_MENU_HEIGHT - CONTEXT_MENU_VIEWPORT_GAP),
		),
	};
}

function readSelectedTextInContainer(container: HTMLElement | null): string {
	const selection = window.getSelection();
	if (!selection || selection.isCollapsed || selection.rangeCount === 0) return "";
	const text = selection.toString();
	if (!text) return "";
	const anchor = selection.anchorNode;
	if (!container || !anchor || !container.contains(anchor)) return "";
	return text;
}

export interface MessageSelectionContextMenuModel {
	containerRef: RefObject<HTMLDivElement | null>;
	contextMenu: MessageSelectionContextMenuViewProps | null;
	onContextMenuCapture: (event: MouseEvent<HTMLDivElement>) => void;
}

/**
 * Selection-based right-click menu for the message list.
 * Only opens when the user has selected text inside the list.
 */
export function useMessageSelectionContextMenu(): MessageSelectionContextMenuModel {
	const { t } = useTranslation("chat");
	const setInputValue = useSetAtom(inputValueAtom);
	const setFocusInputRequest = useSetAtom(focusInputRequestAtom);
	const containerRef = useRef<HTMLDivElement>(null);
	const [menuState, setMenuState] = useState<MessageSelectionMenuState | null>(null);

	const closeContextMenu = useCallback(() => setMenuState(null), []);

	const onContextMenuCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
		if (event.defaultPrevented) return;
		const target = event.target instanceof Element ? event.target : null;
		if (!target || target.closest("[data-resource-menu-trigger], [data-inline-token], a, button, img")) return;
		const selection = window.getSelection();
		if (
			!selection ||
			!Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index)).some((range) => {
				if (!range.intersectsNode(target)) return false;
				const rects = typeof range.getClientRects === "function" ? [...range.getClientRects()] : [];
				return (
					rects.length === 0 ||
					rects.some(
						(rect) =>
							event.clientX >= rect.left &&
							event.clientX <= rect.right &&
							event.clientY >= rect.top &&
							event.clientY <= rect.bottom,
					)
				);
			})
		)
			return;
		const selectedText = readSelectedTextInContainer(containerRef.current);
		if (!selectedText) return;
		event.preventDefault();
		event.stopPropagation();
		const position = clampPosition(event.clientX, event.clientY);
		setMenuState({ selectedText, ...position });
	}, []);

	const handleCopy = useCallback(() => {
		const text = menuState?.selectedText ?? "";
		closeContextMenu();
		if (!text) return;
		void navigator.clipboard.writeText(text).catch((error) => {
			console.warn("[useMessageSelectionContextMenu] copy failed", error);
		});
	}, [closeContextMenu, menuState?.selectedText]);

	const handleAddToInput = useCallback(() => {
		const text = menuState?.selectedText ?? "";
		closeContextMenu();
		if (!text) return;
		if (!appendInputText(text)) setInputValue((draft) => (draft ? `${draft}\n\n${text}` : text));
		setFocusInputRequest((prev) => prev + 1);
	}, [closeContextMenu, menuState?.selectedText, setFocusInputRequest, setInputValue]);

	const contextMenu: MessageSelectionContextMenuViewProps | null = menuState
		? {
				labels: {
					addToInput: t("messageList.selectionContextMenu.addToInput"),
					copy: t("messageList.selectionContextMenu.copy"),
				},
				onAddToInput: handleAddToInput,
				onClose: closeContextMenu,
				onCopy: handleCopy,
				x: menuState.x,
				y: menuState.y,
			}
		: null;

	return {
		containerRef,
		contextMenu,
		onContextMenuCapture,
	};
}
