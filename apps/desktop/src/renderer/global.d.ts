import type { DesktopApi } from "@preload/api";

declare global {
	interface Window {
		agent567: DesktopApi;
		/** Legacy plugin bridge; first-party renderer code uses `agent567`. */
		vetta: DesktopApi;
	}
}
