import { createHash } from "node:crypto";

/** Small text snapshots stay in local tool details, never in the model-facing tool text. */
export interface FileChangeReceipt {
	readonly version: 1;
	readonly path: string;
	readonly beforeText: string;
	readonly afterText: string;
	readonly beforeRevision: string;
	readonly afterRevision: string;
}
export function fileChangeReceipt(
	path: string,
	before: Buffer | undefined,
	afterText: string,
): FileChangeReceipt | undefined {
	if (!before || before.length > 64 * 1024 || Buffer.byteLength(afterText) > 64 * 1024) return undefined;
	const beforeText = before.toString("utf8");
	if (!Buffer.from(beforeText, "utf8").equals(before) || beforeText.includes("\0") || afterText.includes("\0"))
		return undefined;
	return {
		version: 1,
		path,
		beforeText,
		afterText,
		beforeRevision: createHash("sha256").update(before).digest("hex"),
		afterRevision: createHash("sha256").update(afterText, "utf8").digest("hex"),
	};
}
