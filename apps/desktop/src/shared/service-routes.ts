/** Bootstrap and offline fallback. Extra origins are trusted only after discovery. */
export const API567_ROUTES = {
	mainland: "https://a.567.wiki",
	germany: "https://api.567.wiki",
} as const;

export const API567_DISCOVERY_ORIGIN = API567_ROUTES.germany;
export type Api567RouteId = keyof typeof API567_ROUTES | `https://${string}`;

export interface Api567ServiceRoute {
	id: Api567RouteId;
	origin: string;
	name?: string;
	description?: string;
}

export interface Api567RouteCatalog {
	routes: Api567ServiceRoute[];
	source: "cache" | "builtin" | "live";
	updatedAt?: number;
	refreshFailed?: boolean;
}

export const API567_FALLBACK_ROUTES: Api567ServiceRoute[] = Object.entries(API567_ROUTES).map(([id, origin]) => ({
	id: id as Api567RouteId,
	origin,
}));

export function normalizeApi567Origin(value: unknown): string | undefined {
	if (typeof value !== "string" || value.length > 500) return undefined;
	try {
		const url = new URL(value);
		if (url.protocol !== "https:" || url.port || url.username || url.password || url.search || url.hash)
			return undefined;
		if (!["", "/", "/v1", "/v1/", "/api/v1", "/api/v1/"].includes(url.pathname)) return undefined;
		if (
			!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(url.hostname) ||
			/(?:^|\.)(?:localhost|local|internal|invalid)$/i.test(url.hostname)
		)
			return undefined;
		return url.origin;
	} catch {
		return undefined;
	}
}

export function api567RouteOrigin(id: Api567RouteId): string {
	return id === "mainland" || id === "germany" ? API567_ROUTES[id] : id;
}

export function api567RouteId(origin: string): Api567RouteId {
	return origin === API567_ROUTES.mainland
		? "mainland"
		: origin === API567_ROUTES.germany
			? "germany"
			: (origin as `https://${string}`);
}

/** This consumes the public /api/status API information list, never admin instances. */
export function parseApi567RouteList(value: unknown): Api567ServiceRoute[] {
	if (!Array.isArray(value) || value.length > 50) throw new Error("Invalid service route list");
	const seen = new Set<string>();
	const routes: Api567ServiceRoute[] = [];
	for (const item of value) {
		if (!item || typeof item !== "object") continue;
		const origin = normalizeApi567Origin("url" in item ? item.url : undefined);
		if (!origin || seen.has(origin)) continue;
		const name = "route" in item && typeof item.route === "string" ? item.route.trim().slice(0, 100) : "";
		const description =
			"description" in item && typeof item.description === "string" ? item.description.trim().slice(0, 200) : "";
		seen.add(origin);
		routes.push({
			id: api567RouteId(origin),
			origin,
			...(name ? { name } : {}),
			...(description ? { description } : {}),
		});
	}
	if (!routes.length) throw new Error("Service route list is empty");
	return routes;
}

export function isApi567RouteId(value: unknown): value is Api567RouteId {
	return (
		value === "mainland" ||
		value === "germany" ||
		(typeof value === "string" && normalizeApi567Origin(value) === value)
	);
}

export function getBuiltinApi567Route(
	value: string | undefined,
	trustedOrigins: readonly string[] = [],
): Api567RouteId | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		if (url.username || url.password || url.search || url.hash) return undefined;
		if (!["", "/", "/v1", "/v1/"].includes(url.pathname)) return undefined;
		const origin = normalizeApi567Origin(value);
		if (!origin || (!Object.values<string>(API567_ROUTES).includes(origin) && !trustedOrigins.includes(origin)))
			return undefined;
		return api567RouteId(origin);
	} catch {
		return undefined;
	}
}

export interface Api567RouteProbe {
	route: Api567RouteId;
	ok: boolean;
	elapsedMs?: number;
	error?: "unreachable" | "invalid-response" | "account-rejected" | "account-changed" | "unavailable";
}
