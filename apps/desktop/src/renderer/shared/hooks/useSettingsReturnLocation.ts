import { settingsReturnHrefAtom, usageReturnHrefAtom } from "@shared/store/atoms";
import { useRouter } from "@tanstack/react-router";
import { useSetAtom } from "jotai";
import { useEffect } from "react";

export function useSettingsReturnLocation(): void {
	const router = useRouter();
	const setSettingsReturnHref = useSetAtom(settingsReturnHrefAtom);
	const setUsageReturnHref = useSetAtom(usageReturnHrefAtom);
	useEffect(
		() =>
			router.subscribe("onBeforeNavigate", ({ fromLocation, toLocation }) => {
				const isSettings = (pathname: string) => pathname === "/settings" || pathname.startsWith("/settings/");
				if (!fromLocation || !/^\/(?![\\/])/.test(fromLocation.href)) return;
				if (toLocation.pathname === "/usage" && fromLocation.pathname !== "/usage") {
					setUsageReturnHref(fromLocation.href);
				}
				if (
					isSettings(toLocation.pathname) &&
					!isSettings(fromLocation.pathname) &&
					fromLocation.pathname !== "/usage"
				) {
					setSettingsReturnHref(fromLocation.href);
				}
			}),
		[router, setSettingsReturnHref, setUsageReturnHref],
	);
}
