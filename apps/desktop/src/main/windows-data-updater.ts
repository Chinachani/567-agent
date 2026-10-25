import electronUpdater from "electron-updater";
import electronAppAdapter from "electron-updater/out/ElectronAppAdapter.js";
import { resolveWindowsDataLayoutForProcess } from "./windows-data-layout.js";

const { NsisUpdater } = electronUpdater;
const { ElectronAppAdapter } = electronAppAdapter;

class WindowsDataUpdaterAdapter extends ElectronAppAdapter {
	override get baseCachePath(): string {
		return resolveWindowsDataLayoutForProcess().updaterCache;
	}
}

export class WindowsDataUpdater extends NsisUpdater {
	// Passing an AppAdapter to super selects electron-updater's test constructor,
	// which leaves its HTTP executor null. Initialize the normal Electron transport
	// first, then customize only the storage adapter used by its lazy cache setup.
	protected override readonly app = new WindowsDataUpdaterAdapter();
}
