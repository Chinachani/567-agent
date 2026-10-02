import type { DesktopUpdaterApi } from "../src/preload/api-types/updater.js";

declare global {
	interface Window {
		vettaE2e?: {
			updater: Pick<DesktopUpdaterApi, "check" | "download" | "getState">;
		};
	}
}

export {};
