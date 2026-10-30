import type { UpdateReleaseHistory, UpdaterPreferences } from "../../shared/updater-preferences.js";
export type UpdaterPhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdaterState {
	phase: UpdaterPhase;
	paused?: boolean;
	showReminder?: boolean;
	currentVersion: string;
	latestVersion?: string;
	releaseNote?: string;
	/** 0..1 */
	progress?: number;
	downloadedBytes?: number;
	totalBytes?: number;
	bytesPerSecond?: number;
	assetFileName?: string;
	error?: string;
}

export interface DesktopUpdaterApi {
	getPreferences(): Promise<UpdaterPreferences>;
	setPreferences(preferences: UpdaterPreferences): Promise<UpdaterPreferences>;
	getReleaseHistory(): Promise<UpdateReleaseHistory>;
	check(): Promise<UpdaterState>;
	/** 机会性后台补查：忙碌或距上次检查太近时静默跳过，不改变 UI 的忙碌态。 */
	sync(): Promise<void>;
	getState(): Promise<UpdaterState>;
	getCurrentVersion(): Promise<string>;
	/** 启动后台下载（无感）。返回最终状态。 */
	download(): Promise<UpdaterState>;
	/** Pause the transfer; starting the same update again reuses verified download pieces. */
	pause(): Promise<void>;
	/** 立即重启并安装（仅当 state.phase === "ready"） */
	install(): Promise<void>;
	/** 用户点"稍后"：关闭提示；应用退出时由 electron-updater 自动安装 */
	dismiss(): Promise<void>;
	/** 取消待下载或正在进行的下载；已下载完成时不执行操作 */
	cancel(): Promise<void>;
	/** 订阅状态变化。返回取消函数。 */
	onStateChanged(handler: (state: UpdaterState) => void): () => void;
}
