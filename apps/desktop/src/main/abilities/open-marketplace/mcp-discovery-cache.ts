import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { verifyMcpDiscoveryShard } from "./mcp-discovery-catalog.js";
import type { DiscoveryFileRef } from "./mcp-discovery-v2-schema.js";

export async function writeDiscoveryCache(path: string, bytes: string | Uint8Array): Promise<void> {
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, bytes);
		await rename(temporary, path);
	} finally {
		await rm(temporary, { force: true });
	}
}
/** Rebuildable data lives below the marketplace namespace; no installation/configuration files enter this LRU. */
export class DiscoveryFileCache {
	private readonly directory: string;
	private mutation: Promise<void> = Promise.resolve();
	private initialized: Promise<void> | undefined;
	private readonly entries = new Map<string, number>();
	private bytes = 0;
	private initialize(): Promise<void> {
		this.initialized ??= (async () => {
			await mkdir(this.directory, { recursive: true });
			const files = [];
			for (const name of await readdir(this.directory)) {
				if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
				const path = join(this.directory, name);
				const info = await stat(path).catch(() => null);
				if (info?.isFile()) files.push({ path, size: info.size, time: info.mtimeMs });
			}
			for (const file of files.sort((a, b) => a.time - b.time)) {
				this.entries.set(file.path, file.size);
				this.bytes += file.size;
			}
			await this.prune();
		})();
		return this.initialized;
	}
	private touch(path: string, size: number): void {
		this.bytes -= this.entries.get(path) ?? 0;
		this.entries.delete(path);
		this.entries.set(path, size);
		this.bytes += size;
	}
	constructor(
		root: string,
		private readonly repository: string,
		private readonly budget = 200 * 1024 * 1024,
	) {
		this.directory = join(root, "files");
	}
	private path(revision: string, ref: DiscoveryFileRef): string {
		return join(
			this.directory,
			`${createHash("sha256").update(`${this.repository}\n${revision}\n${ref.path}\n${ref.sha256}`).digest("hex")}.json`,
		);
	}
	private serialize<T>(operation: () => Promise<T>): Promise<T> {
		const pending = this.mutation.then(operation);
		this.mutation = pending.then(
			() => undefined,
			() => undefined,
		);
		return pending;
	}
	read(revision: string, ref: DiscoveryFileRef): Promise<Buffer | null> {
		return this.serialize(() => this.readFile(revision, ref));
	}
	private async readFile(revision: string, ref: DiscoveryFileRef): Promise<Buffer | null> {
		const path = this.path(revision, ref);
		try {
			await this.initialize();
			const info = await stat(path);
			if (!info.isFile() || info.size !== ref.sizeBytes) return null;
			const bytes = await readFile(path);
			verifyMcpDiscoveryShard(bytes, ref);
			this.touch(path, bytes.length);
			await utimes(path, new Date(), new Date()).catch(() => undefined);
			return bytes;
		} catch {
			return null;
		}
	}
	async put(revision: string, ref: DiscoveryFileRef, bytes: Buffer): Promise<void> {
		verifyMcpDiscoveryShard(bytes, ref);
		return this.serialize(async () => {
			if (bytes.length > this.budget) return;
			await this.initialize();
			const path = this.path(revision, ref);
			await writeDiscoveryCache(path, bytes);
			this.touch(path, bytes.length);
			await this.prune();
		});
	}
	private async prune(): Promise<void> {
		for (const [path, size] of this.entries) {
			if (this.bytes <= this.budget) break;
			await rm(path, { force: true });
			this.entries.delete(path);
			this.bytes -= size;
		}
	}
}
