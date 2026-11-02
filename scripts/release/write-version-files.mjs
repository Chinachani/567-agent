import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";

/** Prepare every file first; restore completed replacements if a filesystem operation fails.
 * This is rollback for reported I/O failures, not a crash-atomic multi-file transaction.
 */
export function writeVersionFiles(changes, replace = renameSync) {
	const prepared = changes.map(({ path, text }) => ({
		path,
		text,
		before: existsSync(path) ? readFileSync(path) : null,
		mode: existsSync(path) ? statSync(path).mode : 0o644,
		temp: `${path}.${randomUUID()}.tmp`,
	}));
	const applied = [];
	const recoveryFiles = new Set();
	try {
		for (const item of prepared) {
			if (item.text !== null) writeFileSync(item.temp, item.text, { flag: "wx", mode: item.mode });
		}
		for (const item of prepared) {
			const now = existsSync(item.path) ? readFileSync(item.path) : null;
			if (item.before === null ? now !== null : now === null || !item.before.equals(now)) {
				throw new Error(`File changed while preparing version: ${item.path}`);
			}
		}
		for (const item of prepared) {
			if (item.text === null) rmSync(item.path);
			else replace(item.temp, item.path);
			applied.push(item);
		}
	} catch (error) {
		const failures = [error];
		for (const item of applied.reverse()) {
			try {
				if (item.before === null) rmSync(item.path, { force: true });
				else {
					writeFileSync(item.temp, item.before, { flag: "wx", mode: item.mode });
					renameSync(item.temp, item.path);
				}
			} catch (rollbackError) {
				recoveryFiles.add(item.temp);
				failures.push(rollbackError);
			}
		}
		if (failures.length > 1)
			throw new AggregateError(
				failures,
				`Version update and rollback failed; recovery files: ${[...recoveryFiles].join(", ")}`,
			);
		throw error;
	} finally {
		for (const item of prepared) if (!recoveryFiles.has(item.temp)) rmSync(item.temp, { force: true });
	}
}
