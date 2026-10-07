import { spawnSync } from "node:child_process";

const TAR_PROCESS_OPTIONS = { timeout: 30_000, windowsHide: true, encoding: "utf8" as const };

/** Reject absolute and parent-traversal paths before handing archive members to tar. */
export function assertSafeTarMemberName(memberName: string): void {
	const normalized = memberName.replaceAll("\\", "/");
	if (
		!normalized ||
		/^[A-Za-z]:/.test(normalized) ||
		normalized.startsWith("/") ||
		/[\u0000-\u001f\u007f]/.test(normalized) ||
		normalized.split("/").some((part) => part === "..")
	) {
		throw new Error(`Unsafe path in skill archive: ${JSON.stringify(memberName)}`);
	}
}

/** Extract a tar.gz archive without a shell, after validating every listed member path. */
export function extractTarGz(archivePath: string, destination: string): void {
	const listing = spawnSync("tar", ["-tzf", archivePath], TAR_PROCESS_OPTIONS);
	if (listing.error) throw listing.error;
	if (listing.status !== 0) {
		const detail = listing.stderr.trim();
		throw new Error(detail || `tar archive listing failed with exit code ${String(listing.status)}`);
	}
	for (const memberName of listing.stdout.split(/\r?\n/)) {
		if (memberName) assertSafeTarMemberName(memberName);
	}

	const result = spawnSync(
		"tar",
		["-xzf", archivePath, "-C", destination, "--no-same-owner", "--no-same-permissions"],
		TAR_PROCESS_OPTIONS,
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		const detail = result.stderr.trim();
		throw new Error(detail || `tar extraction failed with exit code ${String(result.status)}`);
	}
}
