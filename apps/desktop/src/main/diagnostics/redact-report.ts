import { homedir } from "node:os";
import { redactSensitiveText } from "../../shared/sentry-privacy.js";

const SECRET_KEY =
	/^(?:authorization|proxy-authorization|cookie|set-cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|desktopSecret|resumeSecret|bootstrapSecret)$/i;
const MAX_DEPTH = 12;

/** Redact before serializing so JSON escaping cannot hide credentials from matching. */
export function redactDiagnosticValue(value: unknown, depth = 0): unknown {
	if (depth >= MAX_DEPTH) return "[redacted nested data]";
	if (typeof value === "string") return redactText(value, depth + 1);
	if (Array.isArray(value)) return value.map((item) => redactDiagnosticValue(item, depth + 1));
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				SECRET_KEY.test(key) ? "[redacted]" : redactDiagnosticValue(item, depth + 1),
			]),
		);
	}
	return value;
}

function jsonEnd(text: string, start: number): number {
	const stack: string[] = [];
	let quoted = false;
	let escaped = false;
	for (let index = start; index < text.length; index++) {
		const char = text[index];
		if (quoted) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') quoted = false;
		} else if (char === '"') quoted = true;
		else if (char === "{" || char === "[") stack.push(char === "{" ? "}" : "]");
		else if (char === "}" || char === "]") {
			if (stack.pop() !== char) return index + 1;
			if (stack.length === 0) return index + 1;
		}
	}
	return text.length;
}

function redactText(input: string, depth: number): string {
	if (depth >= MAX_DEPTH) return "[redacted nested data]";
	// Decode bounded JSON fragments in message strings as well as structured entries.
	let output = "";
	let offset = 0;
	let fragments = 0;
	while (offset < input.length) {
		const relative = input.slice(offset).search(/[[{]/);
		if (relative < 0) break;
		const start = offset + relative;
		const end = jsonEnd(input, start);
		output += input.slice(offset, start);
		try {
			output += JSON.stringify(redactDiagnosticValue(JSON.parse(input.slice(start, end)), depth + 1));
		} catch {
			const fragment = input.slice(start, end);
			output += /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|authorization|cookie)/i.test(
				fragment,
			)
				? "[redacted malformed data]"
				: fragment;
		}
		offset = end;
		if (++fragments >= 64) return `${redactPlain(output)}[remaining data omitted]`;
	}
	return redactPlain(output + input.slice(offset));
}

function redactPlain(input: string): string {
	return redactSensitiveText(input)
		.replace(/(\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, "$1[redacted]")
		.replace(
			/(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|desktopSecret|resumeSecret|bootstrapSecret)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;\]}]+)/gi,
			(match, prefix: string) =>
				`${prefix}${['"', "'"].includes(match[prefix.length] ?? "") ? JSON.stringify("[redacted]") : "[redacted]"}`,
		)
		.replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[redacted-key]")
		.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/gi, "[redacted-data]")
		.replaceAll(homedir(), "~");
}

/** Defense in depth for opted-in logs; the default bundle contains a health summary only. */
export function redactDiagnosticLog(input: string): string {
	return input
		.split("\n")
		.map((line) => {
			try {
				return JSON.stringify(redactDiagnosticValue(JSON.parse(line)));
			} catch {
				return redactText(line, 0);
			}
		})
		.join("\n");
}
