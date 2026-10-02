const SUPPORTED_PROVIDERS = new Set(["generic", "github"]);
const DEFAULT_UPDATE_PROVIDER = "github";
const DEFAULT_UPDATE_GITHUB_OWNER = "Chinachani";
const DEFAULT_UPDATE_GITHUB_REPO = "567-agent";

function requireValue(env, key, provider) {
	const value = env[key]?.trim();
	if (!value) {
		throw new Error(`[update-publish] ${key} is required when VETTA_UPDATE_PROVIDER=${provider}`);
	}
	return value;
}

function normalizeHttpUrl(rawUrl) {
	const url = new URL(rawUrl);
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		throw new Error("[update-publish] VETTA_UPDATE_URL must use http or https");
	}
	return url.toString().replace(/\/+$/, "");
}

export function resolveUpdatePublishConfig(env = process.env) {
	const provider = (env.VETTA_UPDATE_PROVIDER?.trim() || DEFAULT_UPDATE_PROVIDER).toLowerCase();
	if (!SUPPORTED_PROVIDERS.has(provider)) {
		throw new Error(
			`[update-publish] unsupported VETTA_UPDATE_PROVIDER=${provider}; expected generic or github`,
		);
	}
	if (provider === "generic") {
		return {
			provider: "generic",
			url: normalizeHttpUrl(requireValue(env, "VETTA_UPDATE_URL", provider)),
			useMultipleRangeRequest: true,
		};
	}

	return {
		provider: "github",
		owner: env.VETTA_UPDATE_GITHUB_OWNER?.trim() || DEFAULT_UPDATE_GITHUB_OWNER,
		repo: env.VETTA_UPDATE_GITHUB_REPO?.trim() || DEFAULT_UPDATE_GITHUB_REPO,
		releaseType: "release",
	};
}
