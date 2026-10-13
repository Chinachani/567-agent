import type { PluginContext } from "@vetta-org/plugin-sdk";

const RAW_ROOT = "https://raw.githubusercontent.com/Chinachani/567-agent-style-library/main/";
const CDN_ROOT = "https://cdn.jsdelivr.net/gh/Chinachani/567-agent-style-library@main/";
const MAX_BASE64_LENGTH = 700_000;
const requests = new Map<string, Promise<string | null>>();
const waiting: Array<() => void> = [];
let activeRequests = 0;

export function coverSources(url: string): string[] {
	if (url.startsWith(RAW_ROOT)) return [url, CDN_ROOT + url.slice(RAW_ROOT.length)];
	if (url.startsWith(CDN_ROOT)) return [url, RAW_ROOT + url.slice(CDN_ROOT.length)];
	return [url];
}

function imageSource(body: unknown, contentType: string | undefined): string | null {
	if (typeof body !== "string" || !body || body.length > MAX_BASE64_LENGTH) return null;
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return null;
	let mime = contentType?.split(";")[0]?.trim().toLowerCase();
	if (!mime || ["text/plain", "application/octet-stream"].includes(mime)) {
		// Some repository mirrors serve SVG as plain text. Inspect the bytes; never
		// turn an arbitrary HTML/error response into a data URL.
		try {
			const prefix = atob(body.slice(0, Math.min(body.length, 1024))).trimStart();
			if (/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(prefix)) mime = "image/svg+xml";
		} catch {
			return null;
		}
	}
	return mime && ["image/svg+xml", "image/png", "image/jpeg", "image/webp"].includes(mime)
		? `data:${mime};base64,${body}`
		: null;
}

async function cachePath(url: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url));
	return `design-covers/${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}.json`;
}

async function fetchCover(ctx: PluginContext, url: string): Promise<string | null> {
	let path: string | undefined;
	let cachedSource: string | null = null;
	try {
		path = await cachePath(url);
		const cached = JSON.parse((await ctx.storage.readFile(path, "utf8")) ?? "null") as Record<string, unknown>;
		if (cached.url === url) {
			const source = imageSource(cached.body, typeof cached.mime === "string" ? cached.mime : undefined);
			cachedSource = source;
			const age = Date.now() - Number(cached.fetchedAt);
			if (source && age >= 0 && age < 24 * 60 * 60 * 1000) return source;
		}
	} catch {
		// First use or damaged cache: fetch a fresh cover.
	}
	if (activeRequests >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
	else activeRequests++;
	try {
		for (const sourceUrl of coverSources(url)) {
			try {
				const response = await ctx.network.request<string>({
					url: sourceUrl,
					method: "GET",
					responseType: "base64",
					timeoutMs: 10_000,
				});
				if (!response.ok) continue;
				const mime = Object.entries(response.headers).find(([name]) => name.toLowerCase() === "content-type")?.[1];
				const source = imageSource(response.body, mime);
				if (!source) continue;
				if (path) {
					await ctx.storage
						.writeFile(
							path,
							JSON.stringify({
								url,
								fetchedAt: Date.now(),
								mime: source.split(";")[0].slice(5),
								body: response.body,
							}),
							"utf8",
						)
						.catch(() => {});
				}
				return source;
			} catch {
				// Cover mirrors have the same permission boundary as the catalog.
			}
		}
		return cachedSource;
	} finally {
		const next = waiting.shift();
		if (next) next();
		else activeRequests--;
	}
}

/** Share in-flight requests and persist successful covers for offline reopening. */
export function loadDesignCover(ctx: PluginContext, url: string): Promise<string | null> {
	const existing = requests.get(url);
	if (existing) return existing;
	// Share only active work. Successful covers live in the dated disk cache;
	// retaining settled promises would bypass its expiry and cache failures.
	const request = fetchCover(ctx, url).finally(() => requests.delete(url));
	requests.set(url, request);
	return request;
}
