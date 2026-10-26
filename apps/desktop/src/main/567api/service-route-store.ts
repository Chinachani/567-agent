import { randomUUID } from "node:crypto";
import { chmodSync, constants, copyFileSync } from "node:fs";
import { join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { createVersionedJsonConfigStore } from "@567agent/toolkit/config-store";
import {
	API567_FALLBACK_ROUTES,
	type Api567RouteCatalog,
	type Api567RouteId,
	type Api567ServiceRoute,
	api567RouteOrigin,
	isApi567RouteId,
	normalizeApi567Origin,
	parseApi567RouteList,
} from "../../shared/service-routes.js";
import { ApplicationCacheService } from "../cache/application-cache-service.js";

export class Api567RouteStore {
	private readonly store;
	private readonly cache;

	constructor(private readonly home: string) {
		this.store = createVersionedJsonConfigStore({
			path: join(home, "service-route.json"),
			name: "567 API route",
			readErrorPolicy: "throw",
			normalize(value: unknown): { schemaVersion: 1; route: Api567RouteId; knownOrigins?: string[] } {
				// The mainland ingress is not open; the bootstrap is the usable first-run default.
				if (value === undefined) return { schemaVersion: 1, route: "germany" };
				if (
					typeof value !== "object" ||
					value === null ||
					!("route" in value) ||
					!isApi567RouteId(value.route) ||
					!("schemaVersion" in value) ||
					value.schemaVersion !== 1
				)
					throw new Error("Invalid service route configuration");
				const known =
					"knownOrigins" in value && Array.isArray(value.knownOrigins)
						? value.knownOrigins.filter((origin): origin is string => normalizeApi567Origin(origin) === origin)
						: [];
				return {
					schemaVersion: 1,
					route: value.route,
					...(known.length ? { knownOrigins: [...new Set(known)].slice(-200) } : {}),
				};
			},
		});
		this.cache = createVersionedJsonConfigStore({
			path: new ApplicationCacheService(join(home, "cache")).namespace("service-routes").path("catalog.json"),
			name: "567 API route catalog",
			normalize(value: unknown): { schemaVersion: 1; routes: Api567ServiceRoute[]; updatedAt: number } | undefined {
				if (value === undefined) return undefined;
				if (
					!value ||
					typeof value !== "object" ||
					!("schemaVersion" in value) ||
					value.schemaVersion !== 1 ||
					!("routes" in value) ||
					!Array.isArray(value.routes) ||
					!("updatedAt" in value) ||
					typeof value.updatedAt !== "number" ||
					!Number.isFinite(value.updatedAt) ||
					value.updatedAt <= 0
				)
					throw new Error("Invalid route catalog cache");
				const routes = parseApi567RouteList(
					value.routes.map((route: Api567ServiceRoute) => ({
						url: route?.origin,
						route: route?.name,
						description: route?.description,
					})),
				);
				return { schemaVersion: 1, routes, updatedAt: value.updatedAt };
			},
		});
	}

	get selectedRoute(): Api567RouteId | undefined {
		try {
			return this.route;
		} catch {
			return undefined;
		}
	}

	get route(): Api567RouteId {
		return this.store.readSync().route;
	}
	get origin(): string {
		return api567RouteOrigin(this.route);
	}
	get trustedOrigins(): string[] {
		const config = this.store.readSync();
		return [
			...new Set([
				...API567_FALLBACK_ROUTES.map((route) => route.origin),
				...this.catalog.routes.map((route) => route.origin),
				...(config.knownOrigins ?? []),
				api567RouteOrigin(config.route),
			]),
		];
	}
	get catalog(): Api567RouteCatalog {
		const cached = this.cache.readSync();
		const routes = [...(cached?.routes ?? API567_FALLBACK_ROUTES)];
		const selected = this.selectedRoute;
		if (selected && !routes.some((route) => route.id === selected))
			routes.push({ id: selected, origin: api567RouteOrigin(selected) });
		return { routes, source: cached ? "cache" : "builtin", ...(cached ? { updatedAt: cached.updatedAt } : {}) };
	}
	resolve(route: Api567RouteId): Api567ServiceRoute | undefined {
		return this.catalog.routes.find((entry) => entry.id === route);
	}
	async saveCatalog(routes: Api567ServiceRoute[]): Promise<void> {
		await this.cache.write({ schemaVersion: 1, routes, updatedAt: Date.now() });
	}

	async select(route: Api567RouteId): Promise<void> {
		if (!this.resolve(route)) throw new Error("Service route is not in the discovered catalog");
		let known: string[] = [];
		const previous = this.selectedRoute;
		if (previous) known = this.store.readSync().knownOrigins ?? [];
		else {
			// Explicit user selection repairs the configuration, keeping the original for recovery.
			const backup = join(this.home, `service-route.invalid-${randomUUID()}.json`);
			copyFileSync(join(this.home, "service-route.json"), backup, constants.COPYFILE_EXCL);
			chmodSync(backup, 0o600);
		}
		await this.store.write({
			schemaVersion: 1,
			route,
			knownOrigins: [
				...new Set([...known, ...(previous ? [api567RouteOrigin(previous)] : []), api567RouteOrigin(route)]),
			],
		});
	}

	async initialize(): Promise<void> {
		await this.store.write(this.store.readSync());
	}
}

let routeStore: Api567RouteStore | undefined;
export function getApi567RouteStore(): Api567RouteStore {
	routeStore ??= new Api567RouteStore(getAgent567HomePath());
	return routeStore;
}
