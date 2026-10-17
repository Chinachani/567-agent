import { homedir } from "node:os";
import { redactSensitiveText } from "../../shared/sentry-privacy.js";

/** Defense in depth for explicitly opted-in logs; the default bundle contains a health summary only. */
export function redactDiagnosticLog(input: string): string {
	return redactSensitiveText(input)
		.replace(
			/(["']?(?:authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|desktopSecret|resumeSecret|bootstrapSecret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)/gi,
			"$1[redacted]",
		)
		.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
		.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, "[redacted-data]")
		.replaceAll(homedir(), "~");
}
