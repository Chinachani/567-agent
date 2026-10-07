import type { ErrorComponentProps } from "@tanstack/react-router";
import type { RouteErrorPageViewProps } from "@vetta-org/theme-ui/overlays";
import { useEffect, useMemo } from "react";

export function useRouteErrorPageModel({
	error,
	reset,
}: ErrorComponentProps): Omit<RouteErrorPageViewProps, "homeAction"> {
	const message = error instanceof Error ? error.message : String(error);

	useEffect(() => {
		// Chromium's `console-message` event only persists the rendered message, not
		// the Error object. Include the stack and route explicitly so failed lazy
		// imports identify the chunk instead of being reduced to "Unexpected token".
		const route = window.location.hash.split("?")[0] || "#/";
		const detail = error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error);
		console.error(`[router error] route=${route} ${detail.replace(/\s+/g, " ")}`);
	}, [error]);

	return useMemo(
		() => ({
			labels: {
				bannerTitle: "当前页面遇到问题",
				home: "返回首页",
				pageTitle: "页面内容没有正常加载",
				retry: "重试",
				retryPage: "重试当前页面",
				suggestion: "这通常是临时状态。你可以重试当前页面，或先回到首页继续其他操作。",
			},
			message,
			onRetry: reset,
		}),
		[message, reset],
	);
}
