import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadEvent, DownloadItem } from "../../preload/api-types/downloads.js";
import { DesktopDownloadService } from "./download-service.js";

const paths = vi.hoisted(() => ({ downloads: "", userData: "" }));

vi.mock("electron", () => ({
	app: {
		getPath: (name: string) => (name === "downloads" ? paths.downloads : paths.userData),
	},
	shell: {
		openPath: () => Promise.resolve(""),
		showItemInFolder: () => undefined,
	},
}));

let testRoot = "";

beforeEach(async () => {
	testRoot = await mkdtemp(join(tmpdir(), "vetta-download-service-"));
	paths.downloads = join(testRoot, "downloads");
	paths.userData = join(testRoot, "user-data");
	await mkdir(join(paths.userData, "downloads"), { recursive: true });
});

afterEach(async () => {
	await rm(testRoot, { recursive: true, force: true });
});

describe("DesktopDownloadService", () => {
	it.each([
		"CON",
		"nul.txt",
		"AUX.zip",
		"PRN",
		"COM1.txt",
		"LPT9",
		"COM¹.log",
		"trailing.",
		"trailing ",
		"file:stream",
	])("rejects Windows device and ambiguous filenames before starting a request: %s", (filename) => {
		const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
		const transport = vi.fn();
		try {
			Object.defineProperty(process, "platform", { value: "win32", configurable: true });
			const service = new DesktopDownloadService({ cacheRoot: join(testRoot, "cache"), fetch: transport });
			expect(() => service.start({ url: "https://fixture.example/file", filename })).toThrow();
			expect(service.list()).toEqual([]);
			expect(transport).not.toHaveBeenCalled();
		} finally {
			Object.defineProperty(process, "platform", platform);
		}
	});

	it("restores active records as paused and persists cancellation", async () => {
		const persisted: DownloadItem = {
			id: "download",
			url: "https://example.com/file",
			filename: "file",
			path: join(paths.downloads, "file"),
			totalBytes: 10,
			receivedBytes: 5,
			status: "downloading",
			createdAt: 1,
		};
		const statePath = join(paths.userData, "downloads", "downloads.json");
		await writeFile(statePath, JSON.stringify([persisted]), "utf8");
		const service = new DesktopDownloadService({ cacheRoot: join(testRoot, "cache") });
		const events: DownloadEvent[] = [];
		service.attachEventSink((event) => events.push(event));

		expect(service.list()).toEqual([{ ...persisted, status: "paused", speedBytesPerSec: 0 }]);

		service.cancel("download");

		expect(service.list()[0]?.status).toBe("canceled");
		expect(events).toEqual([
			{
				type: "updated",
				item: { ...persisted, status: "canceled", speedBytesPerSec: 0 },
			},
		]);
		const stored = JSON.parse(await readFile(statePath, "utf8")) as DownloadItem[];
		expect(stored[0]?.status).toBe("canceled");
	});
});

async function startFixture(
	mode: "ranges" | "single" | "chunked" | "bad-range" | "bad-range-length" | "no-validator" = "ranges",
) {
	const bytes = Buffer.alloc(5 * 1024 * 1024, 42);
	let etag = '"fixture-v1"';
	const seen: { range: string; authorization?: string }[] = [];
	const server = createServer((request, response) => {
		const range = request.headers.range ?? "";
		seen.push({ range, authorization: request.headers.authorization });
		const match = /^bytes=(\d+)-(\d*)$/.exec(range);
		if (mode === "chunked") {
			response.writeHead(200);
			response.end(bytes);
			return;
		}
		if (mode !== "no-validator") response.setHeader("ETag", etag);
		if (!match || mode === "single") {
			response.writeHead(200, { "Content-Length": bytes.length });
			response.end(bytes);
			return;
		}
		const start = Number(match[1]);
		const end = match[2] ? Number(match[2]) : bytes.length - 1;
		response.writeHead(206, {
			"Content-Range": `bytes ${mode === "bad-range" && start > 0 ? start - 1 : start}-${mode === "bad-range-length" && end > start ? end - 1 : end}/${bytes.length}`,
			"Content-Length": end - start + 1,
		});
		response.end(bytes.subarray(start, end + 1));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing fixture port");
	const service = new DesktopDownloadService({ cacheRoot: join(testRoot, "cache"), fetch });
	return {
		service,
		bytes,
		change() {
			bytes.fill(43);
			etag = '"fixture-v2"';
		},
		seen,
		url: `http://127.0.0.1:${address.port}/file.bin`,
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		},
	};
}

it.each(["ranges", "single", "chunked", "no-validator"] as const)(
	"downloads and publishes one intact file from a %s source",
	async (mode) => {
		const fixture = await startFixture(mode);
		try {
			const item = fixture.service.start({ url: fixture.url });
			await vi.waitFor(() => expect(fixture.service.list()[0]?.status).toBe("completed"));
			expect((await readFile(item.path)).equals(fixture.bytes)).toBe(true);
			expect(fixture.service.list()[0]?.receivedBytes).toBe(fixture.bytes.length);
			if (mode === "ranges")
				expect(fixture.seen.filter((request) => request.range && request.range !== "bytes=0-0")).toHaveLength(4);
		} finally {
			await fixture.close();
		}
	},
);

it("pauses then immediately resumes without overlapping writers or a late failure replacing success", async () => {
	const fixture = await startFixture();
	try {
		let paused = false;
		fixture.service.attachEventSink((event) => {
			if (!paused && event.item?.status === "downloading" && event.item.receivedBytes > 0) {
				paused = true;
				fixture.service.pause(event.item.id);
				fixture.service.resume(event.item.id);
			}
		});
		const item = fixture.service.start({ url: fixture.url });
		await vi.waitFor(() => expect(fixture.service.list()[0]?.status).toBe("completed"));
		expect(paused).toBe(true);
		expect((await readFile(item.path)).equals(fixture.bytes)).toBe(true);
		expect(fixture.seen.some((request) => /^bytes=[1-9]\d*-/.test(request.range))).toBe(true);
	} finally {
		await fixture.close();
	}
});

it("reserves names for queued downloads and keeps each request's private headers with its own task", async () => {
	const fixture = await startFixture();
	try {
		const items = ["first", "second", "third"].map((value) =>
			fixture.service.start({ url: fixture.url, headers: { Authorization: value } }),
		);
		expect(new Set(items.map((item) => item.path)).size).toBe(3);
		await vi.waitFor(() => expect(fixture.service.list().every((item) => item.status === "completed")).toBe(true));
		expect(new Set(fixture.seen.map((request) => request.authorization))).toEqual(
			new Set(["first", "second", "third"]),
		);
		for (const item of items) expect((await readFile(item.path)).equals(fixture.bytes)).toBe(true);
		expect(await readFile(join(paths.userData, "downloads", "downloads.json"), "utf8")).not.toContain(
			"Authorization",
		);
	} finally {
		await fixture.close();
	}
});

it.each(["ranges", "bad-range"] as const)(
	"does not overwrite a destination created during a %s transfer",
	async (mode) => {
		const fixture = await startFixture(mode);
		try {
			const item = fixture.service.start({ url: fixture.url });
			await writeFile(item.path, "external file");
			await vi.waitFor(() => expect(fixture.service.list()[0]?.status).toBe("failed"), { timeout: 4_000 });
			expect(await readFile(item.path, "utf8")).toBe("external file");
		} finally {
			await fixture.close();
		}
	},
);

it("invalidates retained pieces when the file changes while paused", async () => {
	const fixture = await startFixture();
	try {
		let changed = false;
		fixture.service.attachEventSink((event) => {
			if (!changed && event.item?.status === "downloading" && event.item.receivedBytes > 0) {
				changed = true;
				fixture.service.pause(event.item.id);
				fixture.change();
				fixture.service.resume(event.item.id);
			}
		});
		const item = fixture.service.start({ url: fixture.url });
		await vi.waitFor(() => expect(fixture.service.list()[0]?.status).toBe("completed"));
		expect(changed).toBe(true);
		expect((await readFile(item.path)).equals(fixture.bytes)).toBe(true);
	} finally {
		await fixture.close();
	}
});

it("does not publish a file when range bodies exceed their declared ranges", async () => {
	const fixture = await startFixture("bad-range-length");
	try {
		const item = fixture.service.start({ url: fixture.url });
		await vi.waitFor(() => expect(fixture.service.list()[0]?.status).toBe("failed"), { timeout: 4000 });
		await expect(readFile(item.path)).rejects.toThrow();
	} finally {
		await fixture.close();
	}
});
it("removes an immediately canceled job only after its writer settles", async () => {
	const fixture = await startFixture();
	try {
		let removal: Promise<void> | undefined;
		fixture.service.attachEventSink((event) => {
			if (!removal && event.item?.status === "downloading") removal = fixture.service.remove(event.item.id, true);
		});
		fixture.service.start({ url: fixture.url });
		await removal;
		expect(fixture.service.list()).toEqual([]);
		expect(await readdir(paths.downloads)).toEqual([]);
		expect(fixture.seen).toEqual([]);
	} finally {
		await fixture.close();
	}
});
it("keeps a legacy partial file and restarts that unverified record at a free filename", async () => {
	const fixture = await startFixture();
	try {
		await mkdir(paths.downloads, { recursive: true });
		const oldPath = join(paths.downloads, "legacy.bin");
		await writeFile(oldPath, "old partial");
		await writeFile(
			join(paths.userData, "downloads", "downloads.json"),
			JSON.stringify([
				{
					id: "legacy",
					url: fixture.url,
					filename: "legacy.bin",
					path: oldPath,
					totalBytes: fixture.bytes.length,
					receivedBytes: 11,
					createdAt: 1,
					status: "paused",
				},
			]),
		);
		const service = new DesktopDownloadService({ cacheRoot: join(testRoot, "cache"), fetch });
		service.resume("legacy");
		await vi.waitFor(() => expect(service.list()[0]?.status).toBe("completed"));
		expect(await readFile(oldPath, "utf8")).toBe("old partial");
		expect(service.list()[0]?.path).not.toBe(oldPath);
		expect((await readFile(service.list()[0]!.path)).equals(fixture.bytes)).toBe(true);
	} finally {
		await fixture.close();
	}
});

it("restarts a failed unvalidated response instead of combining bytes from different file versions", async () => {
	const bytes = Buffer.alloc(1024, 43);
	let interrupted = false;
	const service = new DesktopDownloadService({
		cacheRoot: join(testRoot, "cache"),
		fetch: async (_url, init) => {
			const range = new Headers(init.headers).get("range");
			if (range === "bytes=0-0")
				return new Response(bytes.subarray(0, 1), {
					status: 206,
					headers: { "content-range": `bytes 0-0/${bytes.length}` },
				});
			if (!interrupted) {
				interrupted = true;
				let started = false;
				return new Response(
					new ReadableStream(
						{
							pull(controller) {
								if (started) controller.error(new Error("Connection lost"));
								else {
									started = true;
									controller.enqueue(Buffer.alloc(256, 42));
								}
							},
						},
						{ highWaterMark: 0 },
					),
					{ headers: { "content-length": String(bytes.length) } },
				);
			}
			const start = Number(/^bytes=(\d+)-/.exec(range ?? "")?.[1] ?? 0);
			return new Response(bytes.subarray(start), {
				status: range ? 206 : 200,
				headers: range
					? { "content-range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` }
					: { "content-length": String(bytes.length) },
			});
		},
	});
	const item = service.start({ url: "https://fixture.example/changing.bin" });
	await vi.waitFor(() => expect(service.list()[0]?.status).toBe("completed"), { timeout: 3000 });
	expect((await readFile(item.path)).equals(bytes)).toBe(true);
});
