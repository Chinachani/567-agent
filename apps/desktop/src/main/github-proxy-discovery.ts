import { MORETOOLS_GITHUB_PROXY_URL, parseMoreToolsGitHubProxyPrefixes } from "../shared/github-download-source.js";

const DISCOVERY_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 1_500;

export async function discoverGitHubProxyPrefix(metadataUrl: string): Promise<string | null> {
	const deadline = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
	try {
		const page = await fetch(MORETOOLS_GITHUB_PROXY_URL, { signal: deadline });
		if (!page.ok) return null;
		const prefixes = parseMoreToolsGitHubProxyPrefixes(await page.text());
		for (const prefix of prefixes) {
			if (deadline.aborted) break;
			try {
				const response = await fetch(`${prefix}${metadataUrl}`, {
					method: "HEAD",
					signal: AbortSignal.any([deadline, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
				});
				if (response.ok && !response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
					return prefix;
				}
			} catch {
				// Try the next published mirror.
			}
		}
	} catch {
		// Discovery is best effort and leaves the official feed available.
	}
	return null;
}
