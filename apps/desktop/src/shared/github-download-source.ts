export type GitHubUpdateSource = "github" | "gh-proxy" | "custom";

export const GH_PROXY_UPDATE_PREFIX = "https://gh-proxy.com/";

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
	if (source === "gh-proxy") return GH_PROXY_UPDATE_PREFIX;
	return normalizeGitHubUpdateProxyUrl(customProxyUrl);
}

/** Prefix a known public github.com URL while leaving every other host untouched. */
export function applyGitHubUpdateProxyPrefix(url: string, prefix: string): string {
	if (!url.startsWith("https://github.com/")) return url;
	return `${prefix}${url}`;
}
