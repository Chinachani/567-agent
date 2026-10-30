import { basename } from "node:path";
import type { ProgressInfo } from "builder-util-runtime";
import type { BrowserWindow } from "electron";
import { normalizeUpdaterPreferences, type UpdaterPreferences } from "../shared/updater-preferences.js";

import type { UpdateEngine, UpdateEngineDownload, UpdateEngineInfo } from "./updater-engine.js";

const EVENT_CHANNEL = "vetta:updater:state";
const DEFAULT_AUTO_DOWNLOAD_DELAY_MS = 20_000;
const DEFAULT_AUTO_DOWNLOAD_RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
const DEFAULT_DOWNLOAD_STALL_TIMEOUT_MS = 120_000;
// 传输结束后的安装准备阶段没有任何进度事件（Squirrel.Mac 要解包近 1GB 的 bundle
// 再逐个校验签名），停滞超时会误判为下载失败，这里换用一个只防死锁的长兜底。
const DEFAULT_STAGING_TIMEOUT_MS = 600_000;
// 只在启动时检查一次，长期不退出应用的用户就长期收不到更新提示，
// 因此进程内还需要一条周期性重查，外加睡眠唤醒与用户打开设置菜单时的机会性补查。

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

export type UpdaterTranslate = (key: string, options?: Record<string, unknown>) => string;

/**
 * 宿主提供的系统电源事件。订阅发生在 app ready 之后（Electron 的 `powerMonitor`
 * 在 ready 前不可用），因此这里只暴露订阅函数，由 {@link UpdaterService.onAppReady} 调用。
 */
export interface UpdaterSystemEvents {
	/** 订阅「系统从睡眠/休眠唤醒」，返回取消订阅函数。 */
	onResume(listener: () => void): () => void;
}

export interface UpdaterServiceOptions {
	preferences?: UpdaterPreferences;
	savePreferences?: (preferences: UpdaterPreferences) => Promise<void>;
	autoDownloadDelayMs?: number;
	autoDownloadRetryDelaysMs?: readonly number[];
	downloadStallTimeoutMs?: number;
	stagingTimeoutMs?: number;
	/** 周期性重查间隔；<= 0 表示关闭周期性重查。 */
	periodicCheckIntervalMs?: number;
	/** 机会性补查（唤醒、打开设置菜单）与上一次检查之间要求的最小间隔。 */
	backgroundCheckMinGapMs?: number;
	systemEvents?: UpdaterSystemEvents;
}

export class UpdaterService {
	private state: UpdaterState;
	private preferences: UpdaterPreferences;
	private readonly savePreferences?: (preferences: UpdaterPreferences) => Promise<void>;
	private started = false;
	private disposed = false;
	private checkRevision = 0;
	private downloadRevision = 0;
	private mainWindow: BrowserWindow | null = null;
	private latestInfo: UpdateEngineInfo | null = null;
	private activeDownload: UpdateEngineDownload | null = null;
	private downloadSettlement: Promise<void> | null = null;
	private autoDownloadTimer: NodeJS.Timeout | null = null;
	private downloadStallTimer: NodeJS.Timeout | null = null;
	private autoDownloadAttempts = 0;
	private autoDownloadOptOut = false;
	private lastProgressEmitAt = 0;
	private lastCheckStartedAt = 0;
	private checkPromise: Promise<UpdaterState> | null = null;
	private periodicCheckTimer: NodeJS.Timeout | null = null;
	private disposeSystemEvents: (() => void) | null = null;
	private readonly autoDownloadDelayMs: number;
	private readonly autoDownloadRetryDelaysMs: readonly number[];
	private readonly downloadStallTimeoutMs: number;
	private readonly stagingTimeoutMs: number;
	private readonly periodicCheckIntervalMs: number | undefined;
	private readonly backgroundCheckMinGapMs: number | undefined;
	private readonly systemEvents: UpdaterSystemEvents | undefined;

	constructor(
		private readonly engine: UpdateEngine,
		currentVersion: string,
		private readonly isPackaged: boolean,
		private readonly translate: UpdaterTranslate,
		options: UpdaterServiceOptions = {},
	) {
		this.preferences = normalizeUpdaterPreferences(options.preferences);
		this.savePreferences = options.savePreferences;
		this.state = {
			showReminder: this.preferences.showReminder,
			phase: "idle",
			currentVersion,
		};
		this.autoDownloadDelayMs = options.autoDownloadDelayMs ?? DEFAULT_AUTO_DOWNLOAD_DELAY_MS;
		this.autoDownloadRetryDelaysMs = options.autoDownloadRetryDelaysMs ?? DEFAULT_AUTO_DOWNLOAD_RETRY_DELAYS_MS;
		this.downloadStallTimeoutMs = options.downloadStallTimeoutMs ?? DEFAULT_DOWNLOAD_STALL_TIMEOUT_MS;
		this.stagingTimeoutMs = options.stagingTimeoutMs ?? DEFAULT_STAGING_TIMEOUT_MS;
		this.periodicCheckIntervalMs = options.periodicCheckIntervalMs;
		this.backgroundCheckMinGapMs = options.backgroundCheckMinGapMs;
		this.systemEvents = options.systemEvents;
	}

	setMainWindow(win: BrowserWindow): void {
		this.mainWindow = win;
		this.emit();
	}

	getPreferences(): UpdaterPreferences {
		return { ...this.preferences };
	}

	async setPreferences(value: UpdaterPreferences): Promise<UpdaterPreferences> {
		const next = normalizeUpdaterPreferences(value);
		await this.savePreferences?.(next);
		this.preferences = next;
		this.setState({ showReminder: next.showReminder });
		this.cancelScheduledAutoDownload();
		if (next.automaticDownload && this.state.phase === "available")
			this.scheduleAutoDownload(this.autoDownloadDelayMs);
		if (this.started) this.schedulePeriodicCheck();
		return this.getPreferences();
	}

	getState(): UpdaterState {
		return { ...this.state };
	}

	async onAppReady(): Promise<void> {
		if (!this.isPackaged || this.disposed || this.started) return;
		this.started = true;
		try {
			await this.engine.onAppReady?.();
		} catch (error) {
			this.started = false;
			throw error;
		}
		if (this.disposed) return;
		this.disposeSystemEvents =
			this.systemEvents?.onResume(() => {
				void this.syncInBackground();
			}) ?? null;
		if (this.preferences.automaticCheck) void this.check();
		this.schedulePeriodicCheck();
	}

	/** 停止周期性重查并退订系统事件；进程退出或测试收尾时调用。 */
	dispose(): void {
		this.disposed = true;
		this.started = false;
		this.checkRevision += 1;
		this.downloadRevision += 1;
		this.cancelScheduledAutoDownload();
		this.clearPeriodicCheckTimer();
		this.clearDownloadStallTimer();
		this.disposeSystemEvents?.();
		this.disposeSystemEvents = null;
		this.mainWindow = null;
		const download = this.activeDownload;
		this.activeDownload = null;
		download?.cancel();
	}

	check(): Promise<UpdaterState> {
		if (this.disposed || ["downloading", "ready", "installing"].includes(this.state.phase))
			return Promise.resolve(this.getState());
		if (this.checkPromise) return this.checkPromise;
		this.lastCheckStartedAt = Date.now();
		this.checkPromise = this.runCheck(this.checkRevision).finally(() => {
			this.checkPromise = null;
			if (this.started) this.schedulePeriodicCheck();
		});
		return this.checkPromise;
	}

	private async runCheck(revision: number): Promise<UpdaterState> {
		if (!this.isPackaged) {
			this.setState({
				phase: "error",
				error: this.translate("updater.errors.developmentUnsupported"),
			});
			return this.getState();
		}

		this.setState({ phase: "checking", error: undefined });
		try {
			const result = await this.engine.checkForUpdates();
			if (this.disposed || revision !== this.checkRevision) return this.getState();
			if (!result) {
				this.setState({
					phase: "error",
					error: this.translate("updater.errors.configurationUnavailable"),
				});
				return this.getState();
			}

			if (!result.hasUpdate) {
				this.latestInfo = null;
				this.setState({
					phase: "idle",
					latestVersion: result.info.version,
					releaseNote: result.info.releaseNote,
					progress: undefined,
					downloadedBytes: undefined,
					totalBytes: undefined,
					assetFileName: undefined,
					error: undefined,
				});
				return this.getState();
			}

			this.latestInfo = result.info;
			this.autoDownloadAttempts = 0;
			this.setState({
				phase: "available",
				latestVersion: result.info.version,
				releaseNote: result.info.releaseNote,
				assetFileName: result.info.assetFileName,
				totalBytes: result.info.totalBytes,
				progress: undefined,
				downloadedBytes: undefined,
				error: undefined,
			});
			this.scheduleAutoDownload(this.autoDownloadDelayMs);
		} catch (error) {
			if (this.disposed || revision !== this.checkRevision) return this.getState();
			console.error("[updater] check failed", error);
			this.setState({
				phase: "error",
				error: this.translate("updater.errors.checkFailed"),
			});
		}
		return this.getState();
	}

	async startDownload(options?: { auto?: boolean }): Promise<UpdaterState> {
		const auto = options?.auto === true;
		if (this.disposed || ["downloading", "ready", "installing"].includes(this.state.phase)) return this.getState();
		if (!this.isPackaged) {
			if (!auto) {
				this.setState({
					phase: "error",
					error: this.translate("updater.errors.developmentUnsupported"),
				});
			}
			return this.getState();
		}

		if (!auto) {
			this.autoDownloadOptOut = false;
			this.cancelScheduledAutoDownload();
		}
		if (!this.latestInfo || this.state.phase === "checking") {
			const revision = this.checkRevision;
			await this.check();
			if (this.disposed || revision !== this.checkRevision || this.state.phase !== "available" || !this.latestInfo)
				return this.getState();
		}
		if (auto && (!this.preferences.automaticDownload || this.autoDownloadOptOut)) return this.getState();
		this.cancelScheduledAutoDownload();
		const revision = ++this.downloadRevision;
		this.lastProgressEmitAt = 0;

		this.setState({
			phase: "downloading",
			paused: false,
			progress: 0,
			downloadedBytes: 0,
			bytesPerSecond: 0,
			totalBytes: this.latestInfo.totalBytes,
			error: undefined,
		});

		// Engine callbacks may arrive after cancellation or after a new download starts.
		const isCurrent = () =>
			!this.disposed && revision === this.downloadRevision && this.state.phase === "downloading";
		try {
			// electron-updater clears its temporary cache when cancellation settles.
			// A resumed attempt must not create files until that cleanup has finished.
			if (this.downloadSettlement) await this.downloadSettlement;
			if (!isCurrent()) return this.getState();
			const download = this.engine.downloadUpdate(
				(progress) => {
					if (isCurrent()) this.onProgress(progress);
				},
				() => {
					if (isCurrent()) this.onStaging();
				},
			);
			this.activeDownload = download;
			const settlement = download.promise.then(
				() => {},
				() => {},
			);
			this.downloadSettlement = settlement;
			void settlement.then(() => {
				if (this.downloadSettlement === settlement) this.downloadSettlement = null;
			});
			this.resetDownloadStallTimer(download);
			const paths = await download.promise;
			if (!isCurrent() || this.activeDownload !== download) return this.getState();
			const downloadedPath = paths.at(-1);
			this.clearDownloadStallTimer();
			this.activeDownload = null;
			this.setState({
				phase: "ready",
				progress: 1,
				downloadedBytes: this.state.totalBytes,
				assetFileName: downloadedPath ? basename(downloadedPath) : this.state.assetFileName,
				error: undefined,
			});
		} catch (error) {
			if (!isCurrent()) return this.getState();
			this.clearDownloadStallTimer();
			this.activeDownload = null;
			console.error("[updater] download failed", error);
			if (auto) {
				this.setState({
					phase: "available",
					progress: undefined,
					downloadedBytes: undefined,
					error: undefined,
				});
			} else {
				this.setState({
					phase: "error",
					error: this.translate("updater.errors.downloadFailed"),
				});
			}
		}
		return this.getState();
	}

	async install(): Promise<void> {
		if (this.disposed || this.state.phase !== "ready") return;
		this.setState({ phase: "installing" });
		try {
			await this.engine.quitAndInstall();
		} catch (error) {
			console.error("[updater] install failed", error);
			this.setState({
				phase: "error",
				error: this.translate("updater.errors.installFailed"),
			});
		}
	}

	dismissReady(): void {
		if (this.state.phase === "ready") this.emit();
	}

	pauseDownload(): void {
		if (this.disposed || this.state.phase !== "downloading") return;
		this.downloadRevision += 1;
		this.autoDownloadOptOut = true;
		this.cancelScheduledAutoDownload();
		this.clearDownloadStallTimer();
		const download = this.activeDownload;
		this.activeDownload = null;
		download?.cancel();
		this.setState({ phase: "available", paused: true, error: undefined });
	}

	cancel(): void {
		if (this.disposed || this.state.phase === "ready" || this.state.phase === "installing") return;
		this.checkRevision += 1;
		this.downloadRevision += 1;
		this.autoDownloadOptOut = true;
		this.cancelScheduledAutoDownload();
		const download = this.activeDownload;
		this.clearDownloadStallTimer();
		this.activeDownload = null;
		download?.cancel();
		this.latestInfo = null;
		this.setState({
			phase: "idle",
			paused: false,
			latestVersion: undefined,
			releaseNote: undefined,
			progress: undefined,
			downloadedBytes: undefined,
			totalBytes: undefined,
			assetFileName: undefined,
			error: undefined,
		});
	}

	/**
	 * 后台重查只在没有进行中的更新流程时发生：已经处于 available/downloading/ready/installing
	 * 时重查没有新信息，还会打断正在进行的下载状态。
	 */
	private async checkIfNotBusy(): Promise<void> {
		if (this.state.phase !== "idle" && this.state.phase !== "error") return;
		await this.check();
	}

	/**
	 * 机会性补查：系统唤醒、用户打开设置菜单等「此刻用户大概率在看应用」的时机调用。
	 * 触发源可能连发，因此与上一次检查间隔不足时直接跳过；补查后重新对齐周期，
	 * 避免刚查完又被积压的定时器再查一次。
	 */
	async syncInBackground(): Promise<void> {
		if (this.disposed || !this.isPackaged || !this.preferences.automaticCheck) return;
		const gap = this.backgroundCheckMinGapMs ?? this.preferences.checkIntervalMinutes * 60_000;
		if (Date.now() - this.lastCheckStartedAt < gap) return;
		await this.checkIfNotBusy();
		this.schedulePeriodicCheck();
	}

	private schedulePeriodicCheck(): void {
		this.clearPeriodicCheckTimer();
		const interval = this.periodicCheckIntervalMs ?? this.preferences.checkIntervalMinutes * 60_000;
		if (this.disposed || !this.started || !this.preferences.automaticCheck || interval <= 0) return;
		const timer = setTimeout(() => {
			this.periodicCheckTimer = null;
			void this.runPeriodicCheck();
		}, interval);
		// 更新检查不应该单独把进程钉在事件循环里。
		timer.unref?.();
		this.periodicCheckTimer = timer;
	}

	private async runPeriodicCheck(): Promise<void> {
		if (this.preferences.automaticCheck) await this.checkIfNotBusy();
		this.schedulePeriodicCheck();
	}

	private clearPeriodicCheckTimer(): void {
		if (!this.periodicCheckTimer) return;
		clearTimeout(this.periodicCheckTimer);
		this.periodicCheckTimer = null;
	}

	private onProgress(progress: ProgressInfo): void {
		if (
			![progress.percent, progress.transferred, progress.total].every(Number.isFinite) ||
			progress.transferred < 0 ||
			progress.total < 0
		)
			return;
		if (this.activeDownload) this.resetDownloadStallTimer(this.activeDownload);
		const now = Date.now();
		if (now - this.lastProgressEmitAt < 250 && progress.transferred < progress.total) return;
		this.lastProgressEmitAt = now;
		this.state = {
			...this.state,
			progress: Math.max(0, Math.min(1, progress.percent / 100)),
			downloadedBytes: progress.transferred,
			bytesPerSecond: Number.isFinite(progress.bytesPerSecond) ? Math.max(0, progress.bytesPerSecond) : 0,
			totalBytes: progress.total,
		};
		this.emit();
	}

	// 安装准备阶段没有进度事件，进度停在引擎给出的最后一个网络值（90%），
	// 与 Windows 的 Inno 阶段语义一致；这里只把停滞超时换成更长的兜底。
	private onStaging(): void {
		const download = this.activeDownload;
		if (!download || this.state.phase !== "downloading") return;
		this.resetDownloadStallTimer(download, this.stagingTimeoutMs);
	}

	private scheduleAutoDownload(delayMs: number): void {
		if (this.disposed || !this.preferences.automaticDownload || this.autoDownloadOptOut || this.autoDownloadTimer)
			return;
		this.autoDownloadTimer = setTimeout(() => {
			this.autoDownloadTimer = null;
			void this.runAutoDownload();
		}, delayMs);
	}

	private async runAutoDownload(): Promise<void> {
		if (this.disposed || !this.preferences.automaticDownload || this.state.phase !== "available") return;
		const revision = this.checkRevision;
		this.autoDownloadAttempts += 1;
		const result = await this.startDownload({ auto: true });
		if (this.disposed || revision !== this.checkRevision || result.phase === "ready" || this.autoDownloadOptOut)
			return;
		const retryDelay = this.autoDownloadRetryDelaysMs[this.autoDownloadAttempts - 1];
		if (retryDelay !== undefined) this.scheduleAutoDownload(retryDelay);
	}

	private cancelScheduledAutoDownload(): void {
		if (!this.autoDownloadTimer) return;
		clearTimeout(this.autoDownloadTimer);
		this.autoDownloadTimer = null;
	}

	private resetDownloadStallTimer(download: UpdateEngineDownload, timeoutMs = this.downloadStallTimeoutMs): void {
		this.clearDownloadStallTimer();
		this.downloadStallTimer = setTimeout(() => {
			if (this.activeDownload !== download) return;
			this.downloadStallTimer = null;
			this.activeDownload = null;
			download.cancel();
			this.setState({
				phase: "error",
				progress: undefined,
				downloadedBytes: undefined,
				error: this.translate("updater.errors.downloadFailed"),
			});
		}, timeoutMs);
	}

	private clearDownloadStallTimer(): void {
		if (!this.downloadStallTimer) return;
		clearTimeout(this.downloadStallTimer);
		this.downloadStallTimer = null;
	}

	private setState(patch: Partial<UpdaterState>): void {
		if (this.disposed) return;
		this.state = { ...this.state, ...patch };
		this.emit();
	}

	private emit(): void {
		const win = this.mainWindow;
		if (!win || win.isDestroyed()) return;
		win.webContents.send(EVENT_CHANNEL, this.state);
	}
}
