import { ipcMain, type WebContents } from "electron";
import { getUiZoomFactor, setUiZoomFactor, stepUiZoom } from "../ui-zoom/ui-zoom-service.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

export const UI_ZOOM_GET_CHANNEL = "vetta:ui-zoom:get";
export const UI_ZOOM_SET_CHANNEL = "vetta:ui-zoom:set";
export const UI_ZOOM_STEP_CHANNEL = "vetta:ui-zoom:step";

export function registerUiZoomIpc(owner: WebContents): () => void {
	ipcMain.handle(UI_ZOOM_GET_CHANNEL, (event) => {
		assertTrustedMainRenderer(event, owner);
		return getUiZoomFactor();
	});
	ipcMain.handle(UI_ZOOM_SET_CHANNEL, (event, raw: unknown) => {
		assertTrustedMainRenderer(event, owner);
		if (typeof raw !== "number" || !Number.isFinite(raw)) throw new Error("Invalid zoom factor");
		return setUiZoomFactor(raw);
	});
	ipcMain.handle(UI_ZOOM_STEP_CHANNEL, (event, raw: unknown) => {
		assertTrustedMainRenderer(event, owner);
		if (raw !== 1 && raw !== -1) throw new Error("Invalid zoom direction");
		return stepUiZoom(raw);
	});
	return () => {
		for (const channel of [UI_ZOOM_GET_CHANNEL, UI_ZOOM_SET_CHANNEL, UI_ZOOM_STEP_CHANNEL])
			ipcMain.removeHandler(channel);
	};
}
