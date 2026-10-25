/** @vitest-environment jsdom */
import { appendAttachmentReadScopes } from "@domains/conversation/services/attachment-read-scope";
import { getDefaultStore } from "jotai";
import { beforeEach, expect, it } from "vitest";
import { inputSegmentsAtom, inputValueAtom, mentionedFilesAtom } from "./chat-atoms";
import {
	activeInputDraftKeyAtom,
	applySessionInputDraft,
	captureSessionInputDraft,
	sessionInputDraftMapAtom,
	switchSessionInputDraftScope,
} from "./session-input-draft";

beforeEach(() => {
	const store = getDefaultStore();
	store.set(activeInputDraftKeyAtom, null);
	store.set(sessionInputDraftMapAtom, {});
});

it("keeps each attachment reading scope across session switches and failed-send restoration", () => {
	const store = getDefaultStore();
	switchSessionInputDraftScope("/A.jsonl");
	store.set(inputValueAtom, "Review file");
	store.set(inputSegmentsAtom, [
		{ kind: "text", text: "Review file" },
		{ kind: "file", path: "/project/spec.pdf" },
	]);
	store.set(mentionedFilesAtom, [
		{ path: "/project/spec.pdf", name: "spec.pdf", isDirectory: false, readScope: "Only pages 5-8" },
	]);
	switchSessionInputDraftScope("/B.jsonl");
	expect(store.get(mentionedFilesAtom)).toEqual([]);
	switchSessionInputDraftScope("/A.jsonl");
	expect(appendAttachmentReadScopes(store.get(inputValueAtom), store.get(mentionedFilesAtom))).toContain(
		"Only pages 5-8",
	);
	const captured = captureSessionInputDraft();
	applySessionInputDraft({ text: "", segments: [], appshot: null });
	applySessionInputDraft(captured);
	expect(appendAttachmentReadScopes(store.get(inputValueAtom), store.get(mentionedFilesAtom))).toContain(
		"Only pages 5-8",
	);
});

it("restores legacy drafts and drops metadata for attachments no longer in the editor", () => {
	const store = getDefaultStore();
	applySessionInputDraft({ text: "", segments: [{ kind: "file", path: "/project/spec.pdf" }], appshot: null });
	expect(store.get(mentionedFilesAtom)).toEqual([{ path: "/project/spec.pdf", name: "spec.pdf", isDirectory: false }]);
});
