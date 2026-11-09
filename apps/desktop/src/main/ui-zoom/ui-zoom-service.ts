import type { WebContents } from "electron";
import { normalizeUiZoomFactor, stepUiZoomFactor, UI_ZOOM_DEFAULT } from "../../shared/ui-zoom.js";
import { readConfigSync, updateDesktopConfig } from "../config/desktop-config-store.js";

export const UI_ZOOM_CHANGED_CHANNEL = "vetta:ui-zoom:changed";
let currentFactor: number | undefined;
let mainContents: WebContents | undefined;
let detach: (() => void) | undefined;
let mutation: Promise<unknown> = Promise.resolve();

export function getUiZoomFactor(): number {
	currentFactor ??= normalizeUiZoomFactor(readConfigSync().uiZoomFactor);
	return currentFactor;
}

export function applyUiZoomToWebContents(contents: WebContents): void {
	if (!contents.isDestroyed() && contents.getZoomFactor() !== getUiZoomFactor())
		contents.setZoomFactor(getUiZoomFactor());
}

/** Own only the main window. Auxiliary windows and guest browsers retain their zoom. */
export function attachUiZoom(contents: WebContents): void {
	detach?.();
	mainContents = contents;
	const apply = () => applyUiZoomToWebContents(contents);
	const cleanup = () => {
		contents.removeListener("did-finish-load", apply);
		contents.removeListener("destroyed", cleanup);
		if (mainContents === contents) mainContents = undefined;
	};
	detach = cleanup;
	apply();
	contents.on("did-finish-load", apply);
	contents.on("destroyed", cleanup);
}

function change(resolve: (current: number) => number): Promise<number> {
	const operation = mutation.then(async () => {
		const next = resolve(getUiZoomFactor());
		if (next === getUiZoomFactor()) return next;
		// Persist first: failed writes must leave both the renderer and the window unchanged.
		await updateDesktopConfig((config) => ({ ...config, uiZoomFactor: next }));
		currentFactor = next;
		if (mainContents && !mainContents.isDestroyed()) {
			applyUiZoomToWebContents(mainContents);
			mainContents.send(UI_ZOOM_CHANGED_CHANNEL, next);
		}
		return next;
	});
	mutation = operation.catch(() => {});
	return operation;
}
export function setUiZoomFactor(value: unknown): Promise<number> {
	return change(() => normalizeUiZoomFactor(value));
}
export function stepUiZoom(direction: 1 | -1): Promise<number> {
	return change((current) => stepUiZoomFactor(current, direction));
}
export function resetUiZoom(): Promise<number> {
	return setUiZoomFactor(UI_ZOOM_DEFAULT);
}
