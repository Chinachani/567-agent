import { RemoteDesktopCapture } from "./remote-desktop-capture.js";
import { RemoteDesktopRoute } from "./remote-desktop-route.js";

declare global {
	interface Window {
		vettaRemoteDesktop?: {
			requestCapture(routeIndex: number): void;
			onInput(message: unknown): void;
		};
		agent567RemoteDesktop?: Window["vettaRemoteDesktop"];
	}
}

const params = new URLSearchParams(window.location.search);
const sessionId = params.get("sessionId");
const capture = new RemoteDesktopCapture(() => navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }));
capture.setRetained(params.get("retainCapture") === "true");
window.addEventListener("vetta:remote-desktop:retain-capture", (event) => {
	capture.setRetained((event as CustomEvent<unknown>).detail === true);
});
let targets: string[];
try {
	const parsed: unknown = JSON.parse(params.get("targets") ?? "[]");
	targets = Array.isArray(parsed) ? parsed.filter((target): target is string => typeof target === "string") : [];
} catch {
	targets = [];
}
if (!sessionId || targets.length === 0) throw new Error("remote desktop host targets are missing");

const routes = targets.map(
	(target, index) =>
		new RemoteDesktopRoute({
			target,
			sessionId,
			capture,
			requestCapture: () => window.agent567RemoteDesktop?.requestCapture(index),
			onInput: (message) => window.agent567RemoteDesktop?.onInput(message),
			logger: {
				debug: (message, fields) => console.debug(message, fields),
				info: (message, fields) => console.info(message, fields),
				warn: (message, fields) => console.warn(message, fields),
			},
		}),
);

let inputEnabled = false;
let pointerMode: "absolute" | "relative" = params.get("pointerMode") === "relative" ? "relative" : "absolute";
window.addEventListener("vetta:remote-desktop:input-permission", (event) => {
	const detail = (event as CustomEvent<unknown>).detail;
	if (typeof detail === "boolean") inputEnabled = detail;
	else if (
		detail &&
		typeof detail === "object" &&
		"enabled" in detail &&
		"pointerMode" in detail &&
		typeof detail.enabled === "boolean" &&
		["absolute", "relative"].includes(String(detail.pointerMode))
	) {
		inputEnabled = detail.enabled;
		pointerMode = detail.pointerMode === "relative" ? "relative" : "absolute";
	} else return;
	for (const route of routes) route.setInputEnabled(inputEnabled, pointerMode);
});

for (const route of routes) {
	route.setInputEnabled(inputEnabled, pointerMode);
	void route.connect();
}

window.addEventListener("vetta:remote-desktop:capture-request", (event) => {
	const routeIndex = (event as CustomEvent<unknown>).detail;
	if (typeof routeIndex !== "number" || !Number.isSafeInteger(routeIndex)) return;
	void routes[routeIndex]?.startHost();
});

window.addEventListener("pagehide", () => {
	for (const route of routes) route.close();
	capture.close();
});
