import { randomUUID } from "node:crypto";
import { constants, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { copyFile, link, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, win32 } from "node:path";
import { app, shell } from "electron";
import type { DownloadEvent, DownloadItem, DownloadStartParams } from "../../preload/api-types/downloads.js";
import { getApplicationCacheService } from "../cache/application-cache-service.js";
import { mainT } from "../i18n/index.js";
import { fetchUpdatePackage } from "../update-download-network.js";
import { type FileFetch, RangeFileDownloader } from "./range-download.js";

interface ActiveDownload {
	controller: AbortController;
	done: Promise<void>;
}
interface DownloadRuntime {
	fetch?: FileFetch;
	cacheRoot?: string;
}
type DownloadEventSink = (event: DownloadEvent) => void;
const MAX_CONCURRENT = 2;
const STATUSES = new Set(["queued", "downloading", "paused", "completed", "failed", "canceled"]);

/** UI queue ownership is separate from the streaming transport and its partial files. */
export class DesktopDownloadService {
	private eventSink?: DownloadEventSink;
	private readonly items = new Map<string, DownloadItem>();
	private readonly active = new Map<string, ActiveDownload>();
	private readonly headers = new Map<string, Record<string, string>>();
	private readonly queue: string[] = [];
	private readonly removing = new Set<string>();
	private readonly legacyFiles = new Set<string>();
	private readonly stateFilePath: string;
	private readonly cacheRoot: string;
	private readonly fetch: FileFetch;

	constructor(runtime: DownloadRuntime = {}) {
		const store = join(app.getPath("userData"), "downloads");
		mkdirSync(store, { recursive: true });
		this.stateFilePath = join(store, "downloads.json");
		this.cacheRoot = runtime.cacheRoot ?? getApplicationCacheService().namespace("file-downloads").rootDir;
		// Chromium owns system proxy handling. A dedicated session never sends account cookies.
		this.fetch = runtime.fetch ?? fetchUpdatePackage;
		for (const item of this.load()) {
			if (item.status !== "completed" && existsSync(item.path)) this.legacyFiles.add(item.id);
			if (item.status === "downloading" || item.status === "queued") item.status = "paused";
			item.speedBytesPerSec = 0;
			this.items.set(item.id, item);
		}
	}
	attachEventSink(sink: DownloadEventSink): () => void {
		this.eventSink = sink;
		return () => {
			if (this.eventSink === sink) this.eventSink = undefined;
		};
	}
	start(params: DownloadStartParams): DownloadItem {
		const url = new URL(params.url);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
			throw new Error(mainT("downloads.invalidUrl"));
		const dir = params.saveDir || this.getDefaultDir();
		mkdirSync(dir, { recursive: true });
		let inferred: string;
		try {
			inferred = decodeURIComponent(basename(url.pathname));
		} catch {
			inferred = basename(url.pathname);
		}
		const name = win32.basename(basename(params.filename || inferred || "download"));
		if (!name || name === "." || name === ".." || /[\x00-\x1f]/.test(name))
			throw new Error(mainT("downloads.invalidFilename"));
		if (
			process.platform === "win32" &&
			(/[<>:"|?*]|[. ]$/.test(name) || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(name))
		)
			throw new Error(mainT("downloads.invalidFilename"));
		const finalPath = this.uniqueFilename(dir, name);
		const item: DownloadItem = {
			id: `dl_${randomUUID()}`,
			url: url.href,
			filename: basename(finalPath),
			path: finalPath,
			totalBytes: 0,
			receivedBytes: 0,
			status: "queued",
			createdAt: Date.now(),
		};
		if (params.headers) this.headers.set(item.id, Object.fromEntries(new Headers(params.headers)));
		this.items.set(item.id, item);
		this.queue.push(item.id);
		this.emit({ type: "added", item: { ...item } });
		this.persist();
		this.pump();
		return { ...item };
	}
	pause(id: string): void {
		const item = this.items.get(id);
		if (!item || !["downloading", "queued"].includes(item.status)) return;
		item.status = "paused";
		item.speedBytesPerSec = 0;
		this.dequeue(id);
		this.active.get(id)?.controller.abort();
		this.updated(item);
	}
	resume(id: string): void {
		const item = this.items.get(id);
		if (!item || this.removing.has(id) || !["paused", "failed"].includes(item.status)) return;
		if (this.legacyFiles.delete(id)) {
			// Old releases wrote unverified partial content directly to the final path.
			// Keep that file and restart safely at an available destination.
			item.path = this.uniqueFilename(dirname(item.path), item.filename);
			item.filename = basename(item.path);
			item.receivedBytes = 0;
		}
		item.status = "queued";
		item.error = undefined;
		this.queue.push(id);
		this.updated(item);
		this.pump();
	}
	cancel(id: string): void {
		const item = this.items.get(id);
		if (!item) return;
		item.status = "canceled";
		this.headers.delete(id);
		item.speedBytesPerSec = 0;
		this.dequeue(id);
		this.active.get(id)?.controller.abort();
		this.updated(item);
	}
	async remove(id: string, deleteFile: boolean): Promise<void> {
		const item = this.items.get(id);
		if (!item) return;
		this.removing.add(id);
		this.cancel(id);
		await this.active.get(id)?.done;
		this.items.delete(id);
		this.removing.delete(id);
		this.headers.delete(id);
		await rm(join(this.cacheRoot, id), { recursive: true, force: true }).catch(() => {});
		if (deleteFile) await rm(item.path, { force: true }).catch(() => {});
		this.emit({ type: "removed", id });
		this.persist();
	}
	list(): DownloadItem[] {
		return [...this.items.values()].sort((a, b) => b.createdAt - a.createdAt).map((item) => ({ ...item }));
	}
	async openFile(id: string): Promise<void> {
		const item = this.items.get(id);
		if (item?.status === "completed" && existsSync(item.path)) await shell.openPath(item.path);
	}
	showInFolder(id: string): void {
		const item = this.items.get(id);
		if (item) shell.showItemInFolder(item.path);
	}
	getDefaultDir(): string {
		try {
			return app.getPath("downloads");
		} catch {
			return tmpdir();
		}
	}
	private dequeue(id: string): void {
		const index = this.queue.indexOf(id);
		if (index >= 0) this.queue.splice(index, 1);
	}
	private uniqueFilename(dir: string, name: string): string {
		let candidate = join(dir, name);
		const extension = extname(name);
		const base = basename(name, extension);
		const reserved = new Set([...this.items.values()].map((item) => item.path));
		for (let index = 1; existsSync(candidate) || reserved.has(candidate); index++)
			candidate = join(dir, `${base} (${index})${extension}`);
		return candidate;
	}
	private pump(): void {
		while (this.active.size < MAX_CONCURRENT) {
			// A paused writer retains its slot until all requests and file handles stop.
			const index = this.queue.findIndex((id) => !this.active.has(id));
			if (index < 0) return;
			const [id] = this.queue.splice(index, 1);
			const item = this.items.get(id);
			if (!item || item.status !== "queued") continue;
			const controller = new AbortController();
			const active: ActiveDownload = { controller, done: Promise.resolve() };
			this.active.set(id, active);
			item.status = "downloading";
			active.done = Promise.resolve()
				.then(() => this.transfer(item, controller))
				.catch((error) => {
					if (controller.signal.aborted || !this.items.has(id)) return;
					item.status = "failed";
					const code = error instanceof Error && "code" in error ? error.code : undefined;
					item.error = mainT(code === "EEXIST" ? "downloads.destinationExists" : "downloads.failed");
					item.speedBytesPerSec = 0;
					this.updated(item);
				})
				.finally(() => {
					this.active.delete(id);
					this.pump();
				});
			this.updated(item);
		}
	}
	private async transfer(item: DownloadItem, controller: AbortController): Promise<void> {
		const work = join(this.cacheRoot, item.id);
		await mkdir(work, { recursive: true });
		// Complete file staging is in the destination volume so publication is atomic.
		const staging = join(dirname(item.path), `.${item.id}.part`);
		let emittedAt = 0;
		try {
			await new RangeFileDownloader(work, this.fetch).download(new URL(item.url), staging, {
				signal: controller.signal,
				headers: this.headers.get(item.id),
				allowHttp: true,
				allowUnknownLength: true,
				onProgress: (progress) => {
					if (controller.signal.aborted || item.status !== "downloading") return;
					item.totalBytes = progress.total;
					item.receivedBytes = progress.transferred;
					item.speedBytesPerSec = progress.bytesPerSecond;
					if (Date.now() - emittedAt >= 200 || progress.transferred === progress.total) {
						emittedAt = Date.now();
						this.emit({ type: "updated", item: { ...item } });
					}
				},
			});
			controller.signal.throwIfAborted();
			// link is exclusive: a file created by another app while downloading is never overwritten.
			try {
				await link(staging, item.path);
			} catch (error) {
				const code = error instanceof Error && "code" in error ? error.code : undefined;
				if (!["ENOTSUP", "EOPNOTSUPP", "EPERM", "EXDEV"].includes(String(code))) throw error;
				await copyFile(staging, item.path, constants.COPYFILE_EXCL);
			}
			if (controller.signal.aborted) {
				await rm(item.path, { force: true });
				controller.signal.throwIfAborted();
			}
			item.status = "completed";
			this.headers.delete(item.id);
			item.completedAt = Date.now();
			item.speedBytesPerSec = 0;
			this.updated(item);
		} finally {
			await rm(staging, { force: true }).catch(() => {});
		}
	}
	private load(): DownloadItem[] {
		try {
			const value: unknown = JSON.parse(readFileSync(this.stateFilePath, "utf8"));
			if (!Array.isArray(value)) return [];
			return value.filter((item): item is DownloadItem => {
				if (!item || typeof item !== "object") return false;
				return (
					typeof item.id === "string" &&
					/^[A-Za-z0-9_-]{1,128}$/.test(item.id) &&
					[item.url, item.filename, item.path].every((value) => typeof value === "string") &&
					STATUSES.has(item.status) &&
					[item.totalBytes, item.receivedBytes, item.createdAt].every(Number.isFinite)
				);
			});
		} catch {
			return [];
		}
	}
	private persist(): void {
		try {
			const temporary = `${this.stateFilePath}.tmp`;
			writeFileSync(temporary, JSON.stringify([...this.items.values()]));
			renameSync(temporary, this.stateFilePath);
		} catch {
			/* Restoring a download is best effort and never changes downloaded files. */
		}
	}
	private updated(item: DownloadItem): void {
		this.persist();
		this.emit({ type: "updated", item: { ...item } });
	}
	private emit(event: DownloadEvent): void {
		this.eventSink?.(event);
	}
}
let sharedDownloadService: DesktopDownloadService | undefined;
export function getDesktopDownloadService(): DesktopDownloadService {
	sharedDownloadService ??= new DesktopDownloadService();
	return sharedDownloadService;
}
