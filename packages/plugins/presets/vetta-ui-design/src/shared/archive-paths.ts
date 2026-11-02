import { unzipSync } from "fflate";

/** Portable, canonical paths only: never let the destination OS reinterpret an entry. */
export function assertArchivePath(path: string): void {
	if (
		!path ||
		path.length > 1024 ||
		/[\\:\u0000-\u001f\u007f]/.test(path) ||
		path
			.split("/")
			.some(
				(part) =>
					!part ||
					part === "." ||
					part === ".." ||
					/[. ]$/.test(part) ||
					/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
			)
	)
		throw new Error(`unsafe archive path: ${path}`);
}

/** Shared by ZIP headers and the public in-memory import boundary. */
export class ArchiveEntries {
	private readonly paths = new Map<string, boolean>();
	private readonly parents = new Set<string>();
	private total = 0;

	add(name: string, directory: boolean, size: number): void {
		assertArchivePath(name);
		const key = name.normalize("NFC").toLowerCase();
		if (this.paths.has(key)) throw new Error(`duplicate archive path: ${name}`);
		const parts = key.split("/");
		for (let i = 1; i < parts.length; i++) {
			const parent = parts.slice(0, i).join("/");
			if (this.paths.get(parent) === false) throw new Error(`archive path collision: ${name}`);
			this.parents.add(parent);
		}
		if (!directory && this.parents.has(key)) {
			throw new Error(`archive path collision: ${name}`);
		}
		this.paths.set(key, directory);
		this.total += size;
		if (
			!Number.isSafeInteger(size) ||
			size < 0 ||
			this.paths.size > 10_000 ||
			size > 64 * 1024 * 1024 ||
			this.total > 256 * 1024 * 1024
		) {
			throw new Error("design archive exceeds extraction budget");
		}
	}
}

/** Validate every header before inflation; reject collisions even on case-insensitive disks. */
export function readDesignArchive(bytes: Uint8Array): Record<string, Uint8Array> {
	if (bytes.byteLength > 128 * 1024 * 1024) throw new Error("design archive exceeds 128 MiB");
	const entries = new ArchiveEntries();
	return unzipSync(bytes, {
		filter: (entry) => {
			const directory = entry.name.endsWith("/");
			entries.add(directory ? entry.name.slice(0, -1) : entry.name, directory, entry.originalSize);
			return !directory;
		},
	});
}
