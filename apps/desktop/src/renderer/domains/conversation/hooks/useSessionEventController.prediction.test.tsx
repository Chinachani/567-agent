// @vitest-environment jsdom

import type { RuntimeFailure, SessionEvent } from "@567agent/runtime-core";
import { act, renderHook } from "@testing-library/react";
import { createConversationUserMessage } from "@shared/conversation";
import { activeSessionAtom, chatMessagesAtom, promptSuggestionsAtom } from "@shared/store/atoms";
import { getDefaultStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetStreamState } from "../services/chat-service";
import { useSessionEventController } from "./useSessionEventController";

type EventInput =
	| { type: "session.lifecycle"; phase: "agent_start" | "agent_end" | "aborted"; timestamp?: number }
	| { type: "message.delta"; delta: string }
	| { type: "error"; error: RuntimeFailure };

describe("input prediction after remote turns", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		resetStreamState();
	});

	it.each(["failed", "aborted", "completed"] as const)("predicts only after a successful answer: %s", async (status) => {
		const suggestions = vi.fn(async () => ["Tell me more"]);
		vi.stubGlobal("agent567", {
			session: { getFullHistory: async () => [], nextPromptSuggestions: suggestions },
			config: { get: async () => ({ experimental: { promptPrediction: true } }) },
			api567: { refreshQuota: async () => undefined },
		});
		const store = getDefaultStore();
		const session = { runtimeId: "remote-prediction", cwd: "/tmp/project", sessionPath: "/tmp/session.jsonl" };
		store.set(activeSessionAtom, session);
		store.set(chatMessagesAtom, [createConversationUserMessage({ id: "user-1", text: "Hello" })]);
		store.set(promptSuggestionsAtom, {});
		const { result, unmount } = renderHook(() => useSessionEventController({ activeSessionRef: { current: session } }));
		const event = (fields: EventInput): SessionEvent => ({
			schemaVersion: 1, channel: "runtime", source: "runtime-core", sessionId: session.runtimeId,
			eventId: "prediction-event", timestamp: 1000, ...fields,
		});
		const handle = result.current.createSessionEventHandler(session.runtimeId);
		await act(async () => {
			handle(event({ type: "session.lifecycle", phase: "agent_start" }));
			// A failed response may have partial text; this must not spend more tokens predicting follow-ups.
			handle(event({ type: "message.delta", delta: "Hello there" }));
			if (status === "failed") handle(event({ type: "error", error: {
				code: "AI_TRANSPORT_FAILED", origin: "provider", retryable: false, message: "Connection error.",
			} }));
			handle(event({ type: "session.lifecycle", phase: status === "aborted" ? "aborted" : "agent_end", timestamp: 2000 }));
		});
		if (status === "completed") {
			expect(store.get(promptSuggestionsAtom)[session.runtimeId]).toEqual(["Tell me more"]);
			expect(suggestions).toHaveBeenCalledWith(session.runtimeId, expect.stringContaining("Hello there"));
		} else {
			expect(suggestions).not.toHaveBeenCalled();
			expect(store.get(promptSuggestionsAtom)).toEqual({});
		}
		unmount();
	});
});
