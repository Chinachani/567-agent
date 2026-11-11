import { EventEmitter } from "node:events";
import { beforeEach, expect, it, vi } from "vitest";

const network = vi.hoisted(() => ({ request: vi.fn(), fetch: vi.fn() }));
vi.mock("electron", () => ({
	net: { request: network.request },
	session: { fromPartition: () => ({ fetch: network.fetch }) },
}));

import { createDownloadFetch } from "./update-download-network.js";

beforeEach(() => {
	vi.clearAllMocks();
	network.fetch.mockImplementation(async () => new Response("data"));
	network.request.mockImplementation(() => {
		const request = Object.assign(new EventEmitter(), {
			setHeader: vi.fn(),
			abort: vi.fn(),
			end: () => queueMicrotask(() => request.emit("response")),
		});
		return request;
	});
});
it("discovers redirects once for parallel ranges while Chromium retains proxy and cookie isolation", async () => {
	const fetch = createDownloadFetch();
	for (const range of ["bytes=0-0", "bytes=0-999", "bytes=1000-1999", "bytes=2000-2999"]) {
		const response = await fetch("https://fixture.example/file", {
			headers: { Range: range },
			signal: new AbortController().signal,
		});
		expect(await response.text()).toBe("data");
	}
	expect(network.request).toHaveBeenCalledTimes(1);
	expect(network.request).toHaveBeenCalledWith(
		expect.objectContaining({ credentials: "omit", useSessionCookies: false, redirect: "manual" }),
	);
	expect(network.fetch).toHaveBeenCalledTimes(4);
	expect(network.fetch).toHaveBeenCalledWith(
		expect.any(String),
		expect.objectContaining({ credentials: "omit", redirect: "error" }),
	);
});
it("rediscovers after a stale signed URL fails and isolates authorization contexts", async () => {
	const fetch = createDownloadFetch();
	await fetch("https://fixture.example/file", { headers: { Authorization: "first" } });
	await fetch("https://fixture.example/file", { headers: { Authorization: "second" } });
	network.fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
	await fetch("https://fixture.example/file", { headers: { Authorization: "second" } });
	await fetch("https://fixture.example/file", { headers: { Authorization: "second" } });
	expect(network.request).toHaveBeenCalledTimes(3);
});
it("does not leave an aborted discovery cached for a later resume", async () => {
	const fetch = createDownloadFetch();
	const controller = new AbortController();
	controller.abort();
	await expect(fetch("https://fixture.example/file", { signal: controller.signal })).rejects.toThrow();
	await fetch("https://fixture.example/file", {});
	expect(network.request).toHaveBeenCalledTimes(2);
});
