import type { DesktopApi } from "@preload/api";

const rawApi = window.agent567;
const hostAccessToken = rawApi.hostAccess?.claim();

function bindHostAccess(value: unknown, owner?: object): unknown {
	if (hostAccessToken === undefined) return value;
	if (typeof value === "function") {
		return (...args: unknown[]) =>
			Reflect.apply(value as (...fnArgs: unknown[]) => unknown, owner, [hostAccessToken, ...args]);
	}
	if (Array.isArray(value)) return value.map((item) => bindHostAccess(item, value));
	if (value === null || typeof value !== "object") return value;

	const facade: Record<string, unknown> = {};
	for (const [key, nestedValue] of Object.entries(value)) {
		facade[key] = bindHostAccess(nestedValue, value);
	}
	return facade;
}

export const hostApi = bindHostAccess(rawApi) as DesktopApi;

// The WebDriver packaged E2E runs in Chromium's page world, outside this
// renderer module's host-access wrapper. Expose only updater operations needed
// by that test, and only for a local app launched under WebDriver.
if (window.navigator.webdriver && window.location.protocol === "file:") {
	Object.defineProperty(window, "vettaE2e", {
		configurable: false,
		enumerable: false,
		value: Object.freeze({
			updater: Object.freeze({
				check: hostApi.updater.check,
				download: hostApi.updater.download,
				getState: hostApi.updater.getState,
			}),
		}),
		writable: false,
	});
}
