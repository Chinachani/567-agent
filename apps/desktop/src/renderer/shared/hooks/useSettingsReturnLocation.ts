import { settingsReturnHrefAtom } from "@shared/store/atoms";
import { useRouter } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

export function useSettingsReturnLocation(): void {
	const router = useRouter();
	const setReturnHref = useSetAtom(settingsReturnHrefAtom);
	useEffect(
		() =>
			router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
				const isSettings = (pathname: string) => pathname === "/settings" || pathname.startsWith("/settings/");
				if (fromLocation && !isSettings(fromLocation.pathname) && isSettings(toLocation.pathname)) {
					setReturnHref(fromLocation.href);
				}
			}),
		[router, setReturnHref],
	);
}
