import type { ErrorBlock } from "@shared/store/atoms";

export type ErrorSeverity = "warning" | "error" | "critical";
export type PresentedErrorKind = ErrorBlock["kind"] | "run_limit" | "persistence";

export function presentChatError(block: ErrorBlock): { kind: PresentedErrorKind; severity: ErrorSeverity } {
	const code = block.details?.code?.toLowerCase();
	if (code === "turn_persistence") return { kind: "persistence", severity: "critical" };
	if (
		(code === undefined || code === "turn_failed") &&
		/^Agent run ended with status:\s*max_model_calls(?:\s|$)/i.test(block.text)
	) {
		return { kind: "run_limit", severity: "error" };
	}
	if (block.kind === "rate_limit" || block.kind === "network" || block.kind === "server") {
		return { kind: block.kind, severity: "warning" };
	}
	return { kind: block.kind, severity: "error" };
}
