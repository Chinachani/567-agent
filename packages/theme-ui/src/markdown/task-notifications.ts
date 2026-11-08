import { fromMarkdown } from "mdast-util-from-markdown";

export type BackgroundTaskStatus = "completed" | "failed" | "killed";

const MAX_NOTIFICATION_LENGTH = 16_384;
const OUTPUT_GUIDANCE = "Use the task_output tool to read the command output if needed.";
const CALLER_STOP_GUIDANCE = "The user manually stopped this background task. Do not restart it unless the user asks.";
const NOTIFICATION =
	/^ {0,3}<task-notification>[ \t\r\n]*<task-id>(b\d{1,10})<\/task-id>[ \t\r\n]*(?:<tool-use-id>[^<>\s]{1,512}<\/tool-use-id>[ \t\r\n]*)?<status>(completed|failed|killed)<\/status>[ \t\r\n]*(?:<ended-by>(caller|agent|dispose)<\/ended-by>[ \t\r\n]*)?<output-file>([^<>\r\n\u0000]{1,4096})<\/output-file>[ \t\r\n]*<summary>([^<>\u0000]{1,8192})<\/summary>[ \t\r\n]*<\/task-notification>$/;
/** Legacy hosts wrote a prose notification instead of the structured fields above. */
const LEGACY_NOTIFICATION =
	/^ {0,3}<task-notification>[ \t\r\n]*Task[ \t]+(b\d{1,10})[ \t]+(completed|failed|killed|terminated|stopped)\b[\s\S]*?\bOutput file:[^\r\n<]{1,4096}[\s\S]*?<\/task-notification>$/i;

interface ParsedNotification {
	readonly id: string;
	readonly status: BackgroundTaskStatus;
	readonly end: number;
}

interface MarkdownNode {
	type: string;
	position?: { start: { offset?: number }; end: { offset?: number } };
	children?: readonly MarkdownNode[];
}

function codeRanges(text: string): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	function visit(node: MarkdownNode): void {
		if (node.type === "code" || node.type === "inlineCode") {
			const start = node.position?.start.offset;
			const end = node.position?.end.offset;
			if (start !== undefined && end !== undefined) ranges.push({ start, end });
			return;
		}
		for (const child of node.children ?? []) visit(child);
	}
	visit(fromMarkdown(text));
	return ranges;
}

function normalizeLegacyStatus(value: string): BackgroundTaskStatus {
	const status = value.toLowerCase();
	if (status === "completed") return "completed";
	if (status === "killed" || status === "terminated" || status === "stopped") return "killed";
	return "failed";
}

function parseNotification(text: string, start: number): ParsedNotification | undefined {
	const closing = text.indexOf("</task-notification>", start);
	if (closing < 0) return undefined;
	const end = closing + "</task-notification>".length;
	if (end - start > MAX_NOTIFICATION_LENGTH) return undefined;
	const body = text.slice(start, end);
	const structured = NOTIFICATION.exec(body);
	if (!structured) {
		const legacy = LEGACY_NOTIFICATION.exec(body);
		if (legacy) return { id: legacy[1], status: normalizeLegacyStatus(legacy[2]), end };
		return undefined;
	}
	if (structured[4].trim() && structured[5].trim()) {
		return { id: structured[1], status: structured[2] as BackgroundTaskStatus, end };
	}
	return undefined;
}

/** Display-only projection of complete echoed internal notifications; source and code examples stay intact. */
export function projectTaskNotifications(
	text: string,
	label: (id: string, status: BackgroundTaskStatus) => string,
): string {
	if (!text.includes("<task-notification>")) return text;
	const opening = /^ {0,3}<task-notification>/gm;
	const candidates = [...text.matchAll(opening)];
	if (!candidates.length) return text;
	const protectedRanges = codeRanges(text);
	let result = "";
	let copiedThrough = 0;
	let examinedThrough = 0;
	for (const candidate of candidates) {
		const start = candidate.index;
		if (start < examinedThrough || protectedRanges.some((range) => range.start <= start && range.end > start))
			continue;
		const parsed = parseNotification(text, start);
		if (!parsed) {
			const closing = text.indexOf("</task-notification>", start);
			if (closing < 0) break;
			// A malformed outer block owns its first closing tag; do not reinterpret
			// a nested structured block as an independent notification.
			examinedThrough = closing + "</task-notification>".length;
			continue;
		}
		const { end } = parsed;
		// Never reinterpret an inner block when the enclosing notification is malformed.
		examinedThrough = end;
		// Inline prose, nested/unknown fields and partial streams must remain literal.
		if (!/^[ \t]*(?:\r?\n|$)/.test(text.slice(end))) continue;
		let through = end;
		const stoppedByCaller =
			parsed.status === "killed" && /<ended-by>caller<\/ended-by>/i.test(text.slice(start, end));
		for (const guidance of [...(stoppedByCaller ? [CALLER_STOP_GUIDANCE] : []), OUTPUT_GUIDANCE]) {
			const remaining = text.slice(through);
			const whitespace = /^[ \t\r\n]*/.exec(remaining)![0].length;
			if (!remaining.startsWith(guidance, whitespace)) break;
			const guidanceEnd = through + whitespace + guidance.length;
			if (!/^[ \t]*(?:\r?\n|$)/.test(text.slice(guidanceEnd))) break;
			through = guidanceEnd;
		}
		if (protectedRanges.some((range) => range.start < through && range.end > start)) continue;
		const escapedLabel = label(parsed.id, parsed.status).replace(/[\\`*_[\]<>]/g, "\\$&");
		result += `${text.slice(copiedThrough, start)}> ${escapedLabel}\n\n`;
		copiedThrough = through;
	}
	return copiedThrough ? result + text.slice(copiedThrough) : text;
}
