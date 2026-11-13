import type { ErrorComponentProps } from "@tanstack/react-router";
import type { RouteErrorPageViewLabels } from "@vetta-org/theme-ui/overlays";
import { useCallback, useEffect } from "react";
import { redactSensitiveText } from "@/shared/sentry-privacy";
import { i18n } from "../i18n";
import { RoutePageLoadError } from "../lib/lazy-route-page";

interface RouteErrorPageModel {
	readonly labels: RouteErrorPageViewLabels & {
		readonly home: string;
		readonly retryPage: string;
		readonly reload: string;
	};
	readonly message: string;
	readonly reloadRequired: boolean;
	readonly onRetry: () => void;
	readonly onReload: () => void;
	readonly onReloadHome: () => void;
}

export function useRouteErrorPageModel({ error, reset }: ErrorComponentProps): RouteErrorPageModel {
	const message = error instanceof Error ? error.message : String(error);
	const reloadRequired = error instanceof RoutePageLoadError || error instanceof SyntaxError;
	const onReload = useCallback(() => window.location.reload(), []);
	const onReloadHome = useCallback(() => {
		window.location.hash = "/";
		window.location.reload();
	}, []);

	useEffect(() => {
		// Chromium's `console-message` event only persists the rendered message, not
		// the Error object. Include the stack and route explicitly so failed lazy
		// imports identify the chunk instead of being reduced to "Unexpected token".
		const route = window.location.hash.split("?")[0] || "#/";
		const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
		const module = error instanceof RoutePageLoadError ? ` page=${error.page}` : "";
		const cause =
			error instanceof RoutePageLoadError && error.cause instanceof Error
				? ` cause=${error.cause.stack ?? `${error.cause.name}: ${error.cause.message}`}`
				: "";
		console.error(
			redactSensitiveText(`[router error] route=${route}${module} ${detail}${cause}`).replace(/\s+/g, " "),
		);
	}, [error]);

	return {
		labels: {
			bannerTitle: i18n.t("common:routeError.bannerTitle"),
			home: i18n.t(reloadRequired ? "common:routeError.reloadHome" : "common:routeError.home"),
			pageTitle: i18n.t("common:routeError.pageTitle"),
			retry: i18n.t(reloadRequired ? "common:routeError.reload" : "common:routeError.retry"),
			retryPage: i18n.t(reloadRequired ? "common:routeError.reload" : "common:routeError.retryPage"),
			reload: i18n.t("common:routeError.reload"),
			suggestion: i18n.t(reloadRequired ? "common:routeError.moduleSuggestion" : "common:routeError.suggestion"),
		},
		message,
		reloadRequired,
		onRetry: reloadRequired ? onReload : reset,
		onReload,
		onReloadHome,
	};
}
