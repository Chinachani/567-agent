import { ipcMain, type WebContents } from "electron";
import { getAppIconId, setAppIconId } from "../app-icon/app-icon-service.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

export function registerAppIconIpc(owner: WebContents): () => void {
	const get = "vetta:app-icon:get";
	const set = "vetta:app-icon:set";
	ipcMain.handle(get, (event) => {
		assertTrustedMainRenderer(event, owner);
		return getAppIconId();
	});
	ipcMain.handle(set, (event, value: unknown) => {
		assertTrustedMainRenderer(event, owner);
		return setAppIconId(value);
	});
	return () => {
		ipcMain.removeHandler(get);
		ipcMain.removeHandler(set);
	};
}
