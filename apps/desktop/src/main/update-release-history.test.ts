import { describe, expect, it, vi } from "vitest";
import { UpdateReleaseHistoryService } from "./update-release-history.js";

const entry = (tag: string, extra = {}) => ({
	tag_name: tag,
	html_url: `https://github.com/Chinachani/567-agent/releases/tag/${tag}`,
	body: "Changes",
	published_at: "2026-10-30T00:00:00Z",
	...extra,
});

describe("public update history", () => {
	it("keeps stable official records, bounds the list and coalesces simultaneous reads", async () => {
		const fetcher = vi.fn<typeof fetch>(
			async () =>
				new Response(
					JSON.stringify([
						entry("v1.5.1"),
						entry("v1.5.0"),
						entry("v1.5.2", { draft: true }),
						entry("v1.6.0-beta", { prerelease: true }),
						entry("v1.4.4", { html_url: "https://untrusted.test/" }),
					]),
				),
		);
		const history = new UpdateReleaseHistoryService("1.4.4", fetcher as typeof fetch);
		const [first, second] = await Promise.all([history.get(), history.get()]);
		expect(first).toEqual(second);
		expect(first.baselineVersion).toBe("1.4.4");
		expect(first.releases.map((release) => release.version)).toEqual(["1.5.1", "1.5.0"]);
		await history.get();
		expect(fetcher).toHaveBeenCalledOnce();
		expect(fetcher.mock.calls[0]?.[0]).toBe(
			"https://api.github.com/repos/Chinachani/567-agent/releases?per_page=100",
		);
	});
	it("does not cache a failed request and permits recovery", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response("denied", { status: 403 }))
			.mockResolvedValueOnce(new Response(JSON.stringify([entry("v1.5.0")])));
		const history = new UpdateReleaseHistoryService("1.4.4", fetcher);
		await expect(history.get()).rejects.toThrow("403");
		expect((await history.get()).releases).toHaveLength(1);
	});
	it("rejects malformed or oversized responses", async () => {
		for (const body of ["{}", "x".repeat(4 * 1024 * 1024 + 1)]) {
			const history = new UpdateReleaseHistoryService(
				"1.5.0",
				vi.fn(async () => new Response(body)) as typeof fetch,
			);
			await expect(history.get()).rejects.toThrow();
		}
	});
});
