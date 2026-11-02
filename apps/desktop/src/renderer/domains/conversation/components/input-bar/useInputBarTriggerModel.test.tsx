// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useInputBarTriggerModel } from "./useInputBarTriggerModel";

import { $createParagraphNode, $createTextNode, $getRoot, createEditor, type LexicalEditor } from "lexical";
import { setInputEditor } from "./editor/inputEditorHandle";
let editor: LexicalEditor;
let focus: ReturnType<typeof vi.spyOn>;

Object.defineProperty(window, "agent567", {
	configurable: true,
	value: {
		config: {
			get: vi.fn(async () => ({})),
			onShortcutsChanged: vi.fn(() => () => undefined),
		},
	},
});

function renderTriggerModel(onAtOpenChange?: (open: boolean) => void) {
	return renderHook(() =>
		useInputBarTriggerModel({
			hasSession: true,
			isStreaming: false,
			isEmpty: true,
			canSend: false,
			firstSuggestion: undefined,
			activeSession: { cwd: "C:/workspace", runtimeId: "runtime-1" },
			focusInputRequest: 0,
			onAtOpenChange,
			onSend: vi.fn(async () => undefined),
			onAbort: vi.fn(async () => undefined),
		}),
	);
}

describe("useInputBarTriggerModel", () => {
	beforeEach(() => {
		editor = createEditor({namespace:"trigger-hook",onError:(error)=>{throw error;}});
		editor.update(()=>{const p=$createParagraphNode();p.append($createTextNode("Draft "));$getRoot().append(p);p.selectEnd();},{discrete:true});
		setInputEditor(editor);
		focus = vi.spyOn(editor,"focus");
	});
	afterEach(()=>{setInputEditor(null);vi.restoreAllMocks();});

	it("reports reference visibility separately and clears it when the composer unmounts", () => {
		const onAtOpenChange = vi.fn();
		const { result, unmount } = renderTriggerModel(onAtOpenChange);
		act(() => result.current.handleAtOpen());
		expect(result.current.atOpen).toBe(true);
		expect(onAtOpenChange).toHaveBeenLastCalledWith(true);
		act(() => result.current.handleAtClose());
		expect(onAtOpenChange).toHaveBeenLastCalledWith(false);
		act(() => result.current.handleAtOpen());
		unmount();
		expect(onAtOpenChange).toHaveBeenLastCalledWith(false);
	});

	it("focuses the editor when the command button opens the slash panel", () => {
		const { result } = renderTriggerModel();

		// Mounting a ready session also requests focus; isolate the button interaction itself.
		focus.mockClear();
		act(() => result.current.handlePlusClick());

		expect(result.current.slashOpen).toBe(true);
		expect(focus).toHaveBeenCalledOnce();
	});

	it("reopens a dismissed @ panel after the trigger is deleted and pasted again", () => {
		const { result } = renderTriggerModel();
		const mention = { kind: "at", query: "research", length: 9 } as const;

		act(() => result.current.handleTriggerChange(mention));
		expect(result.current.atOpen).toBe(true);

		act(() => result.current.handleAtClose());
		expect(result.current.atOpen).toBe(false);

		act(() => result.current.handleTriggerChange(mention));
		expect(result.current.atOpen).toBe(false);

		act(() => result.current.handleTriggerChange(null));
		act(() => result.current.handleTriggerChange(mention));
		expect(result.current.atOpen).toBe(true);
	});
	it("opens and toggles references while preserving the existing draft", () => {
		const { result } = renderTriggerModel();
		act(() => result.current.handleAtOpen());
		expect(result.current.atOpen).toBe(true);
		expect(result.current.atFilter).toBe("@");
		expect(editor.getEditorState().read(()=>$getRoot().getTextContent())).toBe("Draft @");
		act(() => result.current.handlePlusClick());
		expect(result.current.slashOpen).toBe(true);
		expect(result.current.atOpen).toBe(false);
		act(() => result.current.handleAtOpen());
		expect(result.current.slashOpen).toBe(false);
		act(() => result.current.handleAtOpen());
		expect(result.current.atOpen).toBe(false);
	});
});
