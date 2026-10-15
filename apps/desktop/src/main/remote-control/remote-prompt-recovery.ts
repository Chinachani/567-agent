import { createHash } from "node:crypto";
import type { RemoteError } from "@567agent/remote-control";
import type { DesktopRemotePromptEvent } from "./desktop-remote-connector.js";

interface Turn {
	readonly sessionId: string;
	readonly fingerprint: string;
	text: string;
	state: string;
	tools: Map<string, Record<string, unknown>>;
	input: unknown;
	usage: unknown;
	error: RemoteError | null;
}

/** Keeps authoritative progress when a phone loses its event subscription. */
export class RemotePromptRecovery {
	private readonly turns = new Map<string, Turn>();

	clear(): void {
		this.turns.clear();
	}

	fingerprint(payload: unknown): string {
		return createHash("sha256")
			.update(JSON.stringify(payload) ?? "null")
			.digest("hex");
	}

	has(turnId: string, sessionId: string, fingerprint: string): boolean {
		const turn = this.turns.get(turnId);
		if (!turn) return false;
		if (turn.sessionId !== sessionId || turn.fingerprint !== fingerprint) {
			throw new Error("Recovery turn identifier belongs to a different request");
		}
		return true;
	}

	start(turnId: string, sessionId: string, fingerprint: string): void {
		this.turns.set(turnId, {
			sessionId,
			fingerprint,
			text: "",
			state: "waiting_response",
			tools: new Map(),
			input: null,
			usage: null,
			error: null,
		});
	}

	record(turnId: string, event: DesktopRemotePromptEvent): void {
		const turn = this.turns.get(turnId);
		if (!turn) return;
		if (event.type === "delta") {
			turn.text = (turn.text + (event.text ?? "")).slice(0, 1_000_000);
			if (event.text) turn.input = null;
		}
		const payload = event.payload;
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
		const value = payload as Record<string, unknown>;
		if (event.type === "tool" && typeof value.toolCallId === "string") {
			const bounded = Object.fromEntries(
				Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? item.slice(0, 8_000) : item]),
			);
			if (JSON.stringify(bounded).length <= 32_000) {
				turn.tools.set(value.toolCallId, { ...turn.tools.get(value.toolCallId), ...bounded });
				if (turn.tools.size > 32) turn.tools.delete(turn.tools.keys().next().value ?? "");
			}
			turn.input = null;
		} else if (event.type === "input") turn.input = payload;
		else if (event.type === "state") {
			if (value.state === "usage") turn.usage = payload;
			else if (typeof value.state === "string") turn.state = value.state;
			if (isTerminal(turn.state)) {
				turn.input = null;
				this.trimFinished();
			}
		}
	}

	answered(sessionId: string, requestId: string): void {
		for (const turn of this.turns.values()) {
			const input = turn.input;
			if (
				turn.sessionId === sessionId &&
				input &&
				typeof input === "object" &&
				"requestId" in input &&
				input.requestId === requestId
			)
				turn.input = null;
		}
	}

	fail(turnId: string, error: RemoteError): void {
		const turn = this.turns.get(turnId);
		if (turn) {
			turn.state = "error";
			turn.error = error;
			turn.input = null;
			this.trimFinished();
		}
	}

	private trimFinished(): void {
		// Active tasks stay available; retain the 16 most recently submitted finished turns.
		const finished = [...this.turns].filter(([, turn]) => isTerminal(turn.state));
		for (const [id] of finished.slice(0, Math.max(0, finished.length - 16))) this.turns.delete(id);
	}

	read(turnId: string, sessionId: string) {
		const turn = this.turns.get(turnId);
		if (!turn || turn.sessionId !== sessionId) return { found: false as const };
		const snapshot = {
			found: true as const,
			truncated: false,
			turnId,
			text: turn.text,
			state: turn.state,
			tools: [...turn.tools.values()],
			input: turn.input,
			usage: turn.usage,
			error: turn.error,
		};
		// Budget the serialized response, including escaping and UTF-8. Leave
		// room for the RPC envelope and event cursor beneath the 1 MiB relay cap.
		const budget = 900_000;
		const size = () => Buffer.byteLength(JSON.stringify(snapshot), "utf8");
		while (size() > budget && snapshot.tools.length > 0) {
			snapshot.tools.shift();
			snapshot.truncated = true;
		}
		if (size() > budget) {
			snapshot.truncated = true;
			let low = 0,
				high = snapshot.text.length;
			const original = snapshot.text;
			while (low < high) {
				const mid = Math.ceil((low + high) / 2);
				snapshot.text = original.slice(0, mid);
				if (size() <= budget) low = mid;
				else high = mid - 1;
			}
			snapshot.text = original.slice(0, low).replace(/[\uD800-\uDBFF]$/, "");
		}
		if (size() > budget)
			throw new Error("Task recovery metadata is too large. Open the desktop conversation to continue.");
		return snapshot;
	}
}

function isTerminal(state: string): boolean {
	return state === "completed" || state === "error" || state === "aborted";
}
