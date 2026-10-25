import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	API567_FALLBACK_ROUTES,
	type Api567RouteCatalog,
	type Api567RouteId,
	type Api567RouteProbe,
} from "../../../../shared/service-routes.js";
import { api567StatusAtom } from "../store/api567-atoms";
import { useApi567 } from "./useApi567";

export function useServiceRoute() {
	const { status } = useApi567();
	const setStatus = useSetAtom(api567StatusAtom);
	const [pending, setPending] = useState<Api567RouteId | null>(null);
	const [results, setResults] = useState<Partial<Record<Api567RouteId, Api567RouteProbe>>>({});
	const [changed, setChanged] = useState(false);
	const [lastRoute, setLastRoute] = useState<Api567RouteId | undefined>();
	const [catalog, setCatalog] = useState<Api567RouteCatalog>();
	const [refreshing, setRefreshing] = useState(false);
	const mounted = useRef(true);
	const refresh = useCallback(
		async (force = false) => {
			setRefreshing(true);
			try {
				const catalog = await window.agent567.api567.refreshServiceRoutes(force);
				if (mounted.current) {
					setCatalog(catalog);
					setStatus((previous) => ({ ...previous, serviceRoutes: catalog }));
				}
			} catch {
				if (mounted.current)
					setCatalog((previous) => ({
						...(previous ?? { routes: API567_FALLBACK_ROUTES, source: "builtin" }),
						refreshFailed: true,
					}));
				if (mounted.current)
					setStatus((previous) => ({
						...previous,
						serviceRoutes: {
							...(previous.serviceRoutes ?? { routes: API567_FALLBACK_ROUTES, source: "builtin" }),
							refreshFailed: true,
						},
					}));
			} finally {
				if (mounted.current) setRefreshing(false);
			}
		},
		[setStatus],
	);
	useEffect(() => {
		mounted.current = true;
		void refresh();
		return () => {
			mounted.current = false;
		};
	}, [refresh]);
	const active = useRef<string | null>(null);
	useEffect(
		() => () => {
			const id = active.current;
			active.current = null;
			if (id) void window.agent567.api567.cancelServiceRouteRequest(id).catch(() => {});
		},
		[],
	);
	const run = useCallback(
		async (route: Api567RouteId, select: boolean) => {
			if (active.current) return;
			const id = crypto.randomUUID();
			active.current = id;
			setPending(route);
			setLastRoute(route);
			setChanged(false);
			try {
				const api = window.agent567.api567;
				const result = await (select ? api.selectServiceRoute(route, id) : api.probeServiceRoute(route, id));
				if (active.current !== id) return;
				setResults((previous) => ({ ...previous, [route]: result }));
				setChanged(select && result.ok);
				if (select && result.ok) {
					const next = await api.getStatus();
					if (active.current === id) setStatus(next);
				}
			} catch {
				if (active.current === id)
					setResults((previous) => ({ ...previous, [route]: { route, ok: false, error: "unreachable" } }));
			} finally {
				if (active.current === id) {
					active.current = null;
					setPending(null);
				}
			}
		},
		[setStatus],
	);
	return {
		route: status.serviceRoute,
		configurationError: status.serviceRouteError === true,
		catalog: catalog ?? status.serviceRoutes ?? { routes: API567_FALLBACK_ROUTES, source: "builtin" as const },
		refreshing,
		refresh,
		pending,
		results,
		lastRoute,
		changed,
		run,
	};
}
