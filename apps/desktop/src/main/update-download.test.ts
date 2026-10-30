import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CancellationToken, type DownloadOptions } from "builder-util-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { ApplicationCacheService } from "./cache/application-cache-service.js";
import { installUpdateDownloader, UpdateDownloader } from "./update-download.js";

const roots: string[] = [];
const servers: Server[] = [];
const bytes = Buffer.alloc(5 * 1024 * 1024);
for (let index = 0; index < bytes.length; index++) bytes[index] = index % 251;
const sha512 = createHash("sha512").update(bytes).digest("base64");

afterEach(async () => {
	for (const server of servers.splice(0)) {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(mode: "ranges" | "single" | "bad-range" | "fallback" | "corrupt" | "chunked" = "ranges") {
	const root = await mkdtemp(join(tmpdir(), "agent567-download-"));
	roots.push(root);
	const requests: string[] = [];
	const server = createServer((request, response) => {
		const requested = request.headers.range ?? "";
		requests.push(requested);
		if (mode === "chunked") {
			response.writeHead(200, { "Transfer-Encoding": "chunked" });
			response.end(bytes);
			return;
		}
		const match = /^bytes=(\d+)-(\d*)$/.exec(requested);
		if (mode === "single" || !match || (mode === "fallback" && requested !== "bytes=0-0")) {
			response.writeHead(200, { "Content-Length": bytes.length });
			response.end(bytes);
			return;
		}
		const start = Number(match[1]);
		const end = match[2] ? Number(match[2]) : bytes.length - 1;
		const body = mode === "corrupt" ? Buffer.alloc(end - start + 1, 10) : bytes.subarray(start, end + 1);
		response.writeHead(206, {
			"Content-Length": body.length,
			"Content-Range": `bytes ${mode === "bad-range" && start > 0 ? start - 1 : start}-${end}/${bytes.length}`,
		});
		response.end(body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	servers.push(server);
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("No fixture port");
	return {
		root,
		requests,
		url: new URL(`http://127.0.0.1:${address.port}/update.deb`),
		downloader: new UpdateDownloader(join(root, "cache"), (url, init) => fetch(url, init)),
		destination: join(root, "package"),
	};
}

describe("full update download", () => {
	it("downloads four ranges and publishes only a checksum-verified package", async () => {
		const f = await fixture();
		const progress: number[] = [];
		await f.downloader.download(f.url, f.destination, {
			sha512,
			cancellationToken: new CancellationToken(),
			onProgress: (value) => progress.push(value.transferred),
		});
		expect((await readFile(f.destination)).equals(bytes)).toBe(true);
		expect(f.requests).toHaveLength(5);
		expect(new Set(f.requests).size).toBe(5);
		expect(progress.at(-1)).toBe(bytes.length);
		expect(await readdir(join(f.root, "cache"))).toEqual([]);
	});
	it.each(["single", "fallback"] as const)("safely falls back when a source uses %s responses", async (mode) => {
		const f = await fixture(mode);
		await f.downloader.download(f.url, f.destination, { sha512, cancellationToken: new CancellationToken() });
		expect((await readFile(f.destination)).equals(bytes)).toBe(true);
		expect(f.requests).toContain("");
	});
	it("pauses an active transfer and resumes retained pieces in a new downloader instance", async () => {
		const f = await fixture();
		const token = new CancellationToken();
		await expect(
			f.downloader.download(f.url, f.destination, {
				sha512,
				cancellationToken: token,
				onProgress: (value) => {
					if (value.transferred > 100_000) token.cancel();
				},
			}),
		).rejects.toThrow();
		await expect(readFile(f.destination)).rejects.toThrow();
		const firstCount = f.requests.length;
		await new UpdateDownloader(join(f.root, "cache"), (url, init) => fetch(url, init)).download(
			f.url,
			f.destination,
			{ sha512, cancellationToken: new CancellationToken() },
		);
		expect((await readFile(f.destination)).equals(bytes)).toBe(true);
		const resumed = f.requests.slice(firstCount + 1);
		expect(
			resumed.some(
				(value) =>
					!["bytes=0-1310719", "bytes=1310720-2621439", "bytes=2621440-3932159", "bytes=3932160-5242879"].includes(
						value,
					),
			),
		).toBe(true);
	});
	it.each(["bad-range", "corrupt"] as const)("does not produce an installer for %s data", async (mode) => {
		const f = await fixture(mode);
		await expect(
			f.downloader.download(f.url, f.destination, { sha512, cancellationToken: new CancellationToken() }),
		).rejects.toThrow();
		await expect(readFile(f.destination)).rejects.toThrow();
	});
	it("keeps the original transport for requests without installer checksums", async () => {
		const f = await fixture();
		const calls: string[] = [];
		const executor = {
			download: async (url: URL, _destination: string, _options: DownloadOptions) => {
				calls.push(url.href);
				return "original";
			},
		};
		installUpdateDownloader(executor, f.downloader);
		expect(await executor.download(f.url, f.destination, { cancellationToken: new CancellationToken() })).toBe(
			"original",
		);
		expect(calls).toEqual([f.url.href]);
		expect(f.requests).toHaveLength(0);
	});
	it("delegates lengthless sources to the original checksum-aware updater transport", async () => {
		const f = await fixture("chunked");
		const options = { sha512, cancellationToken: new CancellationToken() };
		const calls: unknown[][] = [];
		const executor = {
			download: async (url: URL, destination: string, originalOptions: DownloadOptions) => {
				calls.push([url, destination, originalOptions]);
				return "legacy-verified";
			},
		};
		installUpdateDownloader(executor, f.downloader);
		expect(await executor.download(f.url, f.destination, options)).toBe("legacy-verified");
		expect(calls).toEqual([[f.url, f.destination, options]]);
		expect(f.requests).toEqual(["bytes=0-0"]);
	});
	it("uses an isolated cache namespace without removing other caches or user files", async () => {
		const f = await fixture();
		const cache = new ApplicationCacheService(join(f.root, "application-cache"));
		const sibling = cache.namespace("previews");
		await sibling.ensure();
		await writeFile(sibling.path("keep"), "preview");
		await writeFile(join(f.root, "user-file"), "user data");
		const downloads = cache.namespace("update-downloads");
		await new UpdateDownloader(downloads.rootDir, (url, init) => fetch(url, init)).download(f.url, f.destination, {
			sha512,
			cancellationToken: new CancellationToken(),
		});
		expect(await readdir(downloads.rootDir)).toEqual([]);
		expect(await readFile(sibling.path("keep"), "utf8")).toBe("preview");
		expect(await readFile(join(f.root, "user-file"), "utf8")).toBe("user data");
	});
	it("keeps private mirror headers on that origin while stripping them on CDN redirects", async () => {
		const f = await fixture();
		const body = "verified installer";
		const seen: { url: string; headers: Headers }[] = [];
		const downloader = new UpdateDownloader(join(f.root, "redirect-cache"), async (url, init) => {
			const headers = new Headers(init.headers);
			seen.push({ url, headers });
			if (url.startsWith("https://mirror.example/"))
				return new Response(null, { status: 302, headers: { location: "https://cdn.example/package" } });
			if (headers.get("range"))
				return new Response(body[0], { status: 206, headers: { "content-range": `bytes 0-0/${body.length}` } });
			return new Response(body, { headers: { "content-length": String(body.length) } });
		});
		await downloader.download(new URL("https://mirror.example/package"), f.destination, {
			cancellationToken: new CancellationToken(),
			sha512: createHash("sha512").update(body).digest("base64"),
			headers: { Authorization: "fixture-token", "X-Private-Header": "fixture-value" },
		});
		expect(await readFile(f.destination, "utf8")).toBe(body);
		for (const item of seen) {
			expect(item.headers.get("authorization")).toBe(
				item.url.startsWith("https://mirror.example/") ? "fixture-token" : null,
			);
			if (item.url.startsWith("https://cdn.example/")) expect(item.headers.has("x-private-header")).toBe(false);
		}
	});
	it("rejects HTTPS downgrades without delegating to the legacy transport", async () => {
		const f = await fixture();
		const downloader = new UpdateDownloader(
			join(f.root, "redirect-cache"),
			async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/package" } }),
		);
		const executor = { download: async (_url: URL, _path: string, _options: DownloadOptions) => "unsafe fallback" };
		installUpdateDownloader(executor, downloader);
		await expect(
			executor.download(new URL("https://mirror.example/package"), f.destination, {
				sha512,
				cancellationToken: new CancellationToken(),
			}),
		).rejects.toThrow("downgraded HTTPS");
		await expect(readFile(f.destination)).rejects.toThrow();
	});
});
