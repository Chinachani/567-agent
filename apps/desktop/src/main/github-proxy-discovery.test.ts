import { afterEach, expect, it, vi } from "vitest";
import { MORETOOLS_GITHUB_PROXY_URL } from "../shared/github-download-source.js";
import { discoverGitHubProxyPrefix } from "./github-proxy-discovery.js";

const metadataUrl = "https://github.com/example/app/releases/latest/download/latest.yml";

afterEach(() => vi.unstubAllGlobals());

it("probes the release metadata and skips HTML pages returned by broken mirrors", async () => {
	const fetch = vi
		.fn()
		.mockResolvedValueOnce(new Response("<p>https://first.example/</p><p>https://second.example/</p>"))
		.mockResolvedValueOnce(new Response(null, { headers: { "content-type": "text/html; charset=UTF-8" } }))
		.mockResolvedValueOnce(new Response(null, { headers: { "content-type": "application/octet-stream" } }));
	vi.stubGlobal("fetch", fetch);

	await expect(discoverGitHubProxyPrefix(metadataUrl)).resolves.toBe("https://second.example/");
	expect(fetch).toHaveBeenNthCalledWith(
		2,
		`https://first.example/${metadataUrl}`,
		expect.objectContaining({ method: "HEAD" }),
	);
	expect(fetch).toHaveBeenNthCalledWith(
		3,
		`https://second.example/${metadataUrl}`,
		expect.objectContaining({ method: "HEAD" }),
	);
});

it("uses the packaged source when the discovery page is unavailable", async () => {
	const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 403 }));
	vi.stubGlobal("fetch", fetch);

	await expect(discoverGitHubProxyPrefix(metadataUrl)).resolves.toBeNull();
	expect(fetch).toHaveBeenCalledExactlyOnceWith(MORETOOLS_GITHUB_PROXY_URL, expect.any(Object));
});
