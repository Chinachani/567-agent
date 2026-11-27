export type GitHubUpdateSource = "github" | "gh-proxy" | "auto" | "custom";

export const GH_PROXY_UPDATE_PREFIX = "https://gh-proxy.com/";
export const MORETOOLS_GITHUB_PROXY_URL = "https://www.moretools.app/zh-CN/github-proxy";

/** Normalize a user supplied HTTPS URL prefix or return null when it is unsafe/invalid. */
export function normalizeGitHubUpdateProxyUrl(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (trimmed.includes("?") || trimmed.includes("#")) return null;
	try {
		const url = new URL(trimmed);
		if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
			return null;
		}
		const normalizedPath = url.pathname.replace(/\/+$/, "");
		return `${url.origin}${normalizedPath}/`;
	} catch {
		return null;
	}
}

/** Resolve the optional GitHub URL prefix selected by persisted update settings. */
export function resolveGitHubUpdateProxyPrefix(source: GitHubUpdateSource, customProxyUrl: unknown): string | null {
	if (source === "github") return null;
	if (source === "auto") return null;
	if (source === "gh-proxy") return GH_PROXY_UPDATE_PREFIX;
	return normalizeGitHubUpdateProxyUrl(customProxyUrl);
}

export function parseMoreToolsGitHubProxyPrefixes(html: string): string[] {
	const candidates = html.match(/https:\/\/[^\s"'<>&]+\//g) ?? [];
	const ignoredDomains = [
		"moretools.app",
		"github.com",
		"githubusercontent.com",
		"google.com",
		"googlesyndication.com",
	];
	return [
		...new Set(
			candidates
				.map((candidate) => normalizeGitHubUpdateProxyUrl(candidate))
				.filter((value): value is string => {
					if (!value) return false;
					const { hostname } = new URL(value);
					return !ignoredDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
				}),
		),
	];
}

/** Prefix a known public github.com URL while leaving every other host untouched. */
export function applyGitHubUpdateProxyPrefix(url: string, prefix: string): string {
	if (!url.startsWith("https://github.com/")) return url;
	return `${prefix}${url}`;
}
