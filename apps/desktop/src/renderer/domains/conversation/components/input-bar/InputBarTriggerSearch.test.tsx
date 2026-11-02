// @vitest-environment jsdom
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, it, expect, vi } from "vitest";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	type LexicalEditor,
} from "lexical";
import { TriggerPlugin } from "./editor/plugins/TriggerPlugin";
import { setInputEditor } from "./editor/inputEditorHandle";
import { useInputBarTriggerModel } from "./useInputBarTriggerModel";
let editor: LexicalEditor;
Object.defineProperty(window, "agent567", {
	configurable: true,
	value: { config: { get: async () => ({}), onShortcutsChanged: () => () => {} } },
});
function Harness() {
	const [ed] = useLexicalComposerContext();
	editor = ed;
	useEffect(() => {
		setInputEditor(ed);
		return () => setInputEditor(null);
	}, [ed]);
	const m = useInputBarTriggerModel({
		hasSession: true,
		isStreaming: false,
		isEmpty: false,
		canSend: true,
		activeSession: { cwd: "/isolated", runtimeId: "r" },
		focusInputRequest: 0,
		onSend: async () => {},
		onAbort: async () => {},
	});
	return (
		<>
			<TriggerPlugin onTriggerChange={m.handleTriggerChange} />
			<button onClick={m.handleAtOpen}>References</button>
			<button onClick={m.handlePlusClick}>Commands</button>
			<output data-testid="filter">{m.atOpen ? m.atFilter : m.slashOpen ? m.slashFilter : "closed"}</output>
		</>
	);
}
afterEach(() => {
	cleanup();
	setInputEditor(null);
});
it.each([
	["References", "@"],
	["Commands", "/"],
])("typing after opening %s from its button filters its candidates", (name, prefix) => {
	render(
		<LexicalComposer
			initialConfig={{
				namespace: "audit",
				onError: (e) => {
					throw e;
				},
			}}
		>
			<Harness />
		</LexicalComposer>,
	);
	act(() =>
		editor.update(
			() => {
				const p = $createParagraphNode();
				const t = $createTextNode("Draft ");
				p.append(t);
				$getRoot().clear().append(p);
				t.selectEnd();
			},
			{ discrete: true },
		),
	);
	fireEvent.click(screen.getByRole("button", { name }));
	expect(screen.getByTestId("filter").textContent).toBe(prefix);
	act(() =>
		editor.update(
			() => {
				const s = $getSelection();
				if ($isRangeSelection(s)) s.insertText("report");
			},
			{ discrete: true },
		),
	);
	console.log("reference-search", {
		filter: screen.getByTestId("filter").textContent,
		editorText: editor.getEditorState().read(() => $getRoot().getTextContent()),
	});
	expect(screen.getByTestId("filter").textContent).toBe(prefix + "report");
	fireEvent.click(screen.getByRole("button", { name }));
	expect(screen.getByTestId("filter").textContent).toBe("closed");
	fireEvent.click(screen.getByRole("button", { name }));
	expect(screen.getByTestId("filter").textContent).toBe(prefix + "report");
	expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("Draft " + prefix + "report");
});
