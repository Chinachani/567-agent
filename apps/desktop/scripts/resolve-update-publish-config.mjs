const SUPPORTED_PROVIDERS = new Set(["generic", "github"]);
const DEFAULT_UPDATE_PROVIDER = "github";
const DEFAULT_UPDATE_GITHUB_OWNER = "Chinachani";
const DEFAULT_UPDATE_GITHUB_REPO = "567-agent";

function normalizeHttpUrl(rawUrl) {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("[update-publish] AGENT567_UPDATE_URL must use http or https");
	}
	return url.toString().replace(/\/+$/, "");
}

function requireUpdateUrl(env, provider) {
	const value = env.AGENT567_UPDATE_URL?.trim();
	if (!value) throw new Error(`[update-publish] AGENT567_UPDATE_URL is required when AGENT567_UPDATE_PROVIDER=${provider}`);
	return value;
}

export function resolveUpdatePublishConfig(env = process.env) {
	const provider = (env.AGENT567_UPDATE_PROVIDER?.trim() || DEFAULT_UPDATE_PROVIDER).toLowerCase();
	if (!SUPPORTED_PROVIDERS.has(provider)) {
		throw new Error(
			`[update-publish] unsupported AGENT567_UPDATE_PROVIDER=${provider}; expected generic or github`,
		);
	}
	if (provider === "generic") {
		return {
			provider: "generic",
			url: normalizeHttpUrl(requireUpdateUrl(env, provider)),
			useMultipleRangeRequest: true,
		};
	}

	return {
		provider: "github",
		owner: env.AGENT567_UPDATE_GITHUB_OWNER?.trim() || DEFAULT_UPDATE_GITHUB_OWNER,
		repo: env.AGENT567_UPDATE_GITHUB_REPO?.trim() || DEFAULT_UPDATE_GITHUB_REPO,
		releaseType: "release",
	};
}
