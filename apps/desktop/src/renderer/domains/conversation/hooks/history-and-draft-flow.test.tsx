// @vitest-environment jsdom
import { act, fireEvent, render, renderHook, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { getDefaultStore } from "jotai";
import { createCodingAgentHistoricalSessionFileHistoryReader } from "@567agent/coding-agent/historical-sessions";
import { fullHistoryToChat } from "../services/chat-service";
import { useUserMessageEditAction } from "../hooks/useUserMessageActions";
import { useMessageSelectionContextMenu } from "../hooks/useMessageSelectionContextMenu";
import * as atoms from "@shared/store/atoms";
import { prepareInputPrompt, deriveSkillNames } from "@shared/lib/input-tokens";
import { initI18n } from "@shared/i18n";
initI18n();
const store = getDefaultStore();
beforeEach(() => {
	store.set(atoms.activeSessionAtom, {
		runtimeId: "audit-runtime",
		cwd: "/audit",
		sessionPath: "/audit/legacy.jsonl",
	});
	store.set(atoms.pendingSessionOpenAtom, null);
	store.set(atoms.pendingSessionCreationAtom, null);
	store.set(atoms.pendingMessageEditAtom, null);
	store.set(atoms.inputValueAtom, "");
	store.set(atoms.appshotAttachmentAtom, null);
	store.set(atoms.mentionedFilesAtom, []);
	store.set(atoms.attachedImagesAtom, []);
});
for (const legacy of [false, true])
	it(`legacy scene stays inert across history read and edit (old expansion=${legacy})`, () => {
		const stamp = "2025-10-01T00:00:00.000Z";
		const rows = [
			{ type: "session", version: 3, id: "audit-legacy", cwd: "/audit", timestamp: stamp },
			{
				type: "custom_message",
				id: "s",
				parentId: null,
				timestamp: stamp,
				customType: legacy ? "scene_expansion" : "prompt_resource_reference",
				content: legacy ? '<scene name="release">OLD SCENE</scene>' : "",
				display: false,
				details: legacy ? {} : { promptRef: { kind: "scene", name: "release" } },
			},
			{
				type: "message",
				id: "u",
				parentId: "s",
				timestamp: stamp,
				message: { role: "user", content: "Please update the release", timestamp: Date.parse(stamp) },
			},
		];
		const raw = rows.map((x) => JSON.stringify(x)).join("\n");
		const reader = createCodingAgentHistoricalSessionFileHistoryReader({
			readFirstLineSync: () => JSON.stringify(rows[0]),
			readText: () => raw,
		} as never);
		expect(reader.canRead("/audit/legacy.jsonl")).toBe(true);
		const history = reader.read("/audit/legacy.jsonl").history;
		const message = fullHistoryToChat(history).find((x) => x.kind === "user");
		if (!message || message.kind !== "user") throw new Error("fixture has no user message");
		const { result } = renderHook(() =>
			useUserMessageEditAction({ message, isLastUserMessage: true, enabled: true }),
		);
		act(() => result.current.onEdit());
		const draft = store.get(atoms.inputValueAtom),
			skills = deriveSkillNames(prepareInputPrompt(draft).segments);
		console.log("legacy-scene-edit", { legacy, projectedRef: message.promptRef, draft, skills });
		expect(skills).toEqual([]);
	});
function SelectionHarness() {
	const model = useMessageSelectionContextMenu();
	return (
		<div ref={model.containerRef} onContextMenuCapture={model.onContextMenuCapture}>
			<p data-testid="selected">quoted response</p>
			{model.contextMenu && <button onClick={model.contextMenu.onAddToInput}>Add to input</button>}
		</div>
	);
}
it("adding selected text must not silently discard an existing draft", () => {
	store.set(atoms.inputValueAtom, "UNSENT IMPORTANT DRAFT");
	render(<SelectionHarness />);
	const p = screen.getByTestId("selected");
	const range = document.createRange();
	range.selectNodeContents(p);
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	fireEvent.contextMenu(p, { clientX: 10, clientY: 10 });
	fireEvent.click(screen.getByRole("button", { name: "Add to input" }));
	console.log("selection-add", {
		draft: store.get(atoms.inputValueAtom),
		hasConfirmation: !!store.get(atoms.confirmDialogAtom),
	});
	expect(store.get(atoms.inputValueAtom)).toContain("UNSENT IMPORTANT DRAFT");
});

afterEach(() => {
	cleanup();
	window.getSelection()?.removeAllRanges();
});

it("right clicking outside the selection on the same paragraph keeps the message menu available", () => {
	render(<SelectionHarness />);
	const p = screen.getByTestId("selected"),
		range = document.createRange();
	range.selectNodeContents(p);
	Object.defineProperty(range, "getClientRects", { value: () => [{ left: 10, right: 50, top: 10, bottom: 30 }] });
	const selection = window.getSelection()!;
	selection.removeAllRanges();
	selection.addRange(range);
	fireEvent.contextMenu(p, { clientX: 100, clientY: 20 });
	expect(screen.queryByRole("button", { name: "Add to input" })).toBeNull();
	fireEvent.contextMenu(p, { clientX: 20, clientY: 20 });
	expect(screen.getByRole("button", { name: "Add to input" })).toBeTruthy();
});
