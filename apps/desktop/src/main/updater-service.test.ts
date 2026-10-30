import type { ProgressInfo } from "builder-util-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UpdateEngine, UpdateEngineCheckResult, UpdateEngineDownload } from "./updater-engine.js";
import { UpdaterService } from "./updater-service.js";

class FakeUpdateEngine implements UpdateEngine {
	checkResult: UpdateEngineCheckResult | null = null;
	installCalls = 0;
	cancelCalls = 0;
	private progressHandler: ((progress: ProgressInfo) => void) | null = null;
	private stagingHandler: (() => void) | null = null;
	private resolveDownload: ((paths: string[]) => void) | null = null;

	async checkForUpdates(): Promise<UpdateEngineCheckResult | null> {
		return this.checkResult;
	}

	downloadUpdate(onProgress: (progress: ProgressInfo) => void, onStaging?: () => void): UpdateEngineDownload {
		this.progressHandler = onProgress;
		this.stagingHandler = onStaging ?? null;
		return {
			promise: new Promise<string[]>((resolve) => {
				this.resolveDownload = resolve;
			}),
			cancel: () => {
				this.cancelCalls += 1;
			},
		};
	}

	emitProgress(progress: ProgressInfo): void {
		this.progressHandler?.(progress);
	}

	emitStaging(): void {
		this.stagingHandler?.();
	}

	completeDownload(paths: string[]): void {
		this.resolveDownload?.(paths);
	}

	async quitAndInstall(): Promise<void> {
		this.installCalls += 1;
	}
}

const translate = (key: string): string => key;

function createUpToDateEngine(): FakeUpdateEngine {
	const engine = new FakeUpdateEngine();
	engine.checkResult = { hasUpdate: false, info: { version: "0.5.21" } };
	return engine;
}

function createResumeEvents(): {
	events: { onResume(listener: () => void): () => void };
	emit: () => void;
	listenerCount: () => number;
} {
	const listeners = new Set<() => void>();
	return {
		emit: () => {
			for (const listener of listeners) listener();
		},
		events: {
			onResume: (listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		},
		listenerCount: () => listeners.size,
	};
}

function createAvailableEngine(): FakeUpdateEngine {
	const engine = new FakeUpdateEngine();
	engine.checkResult = {
		hasUpdate: true,
		info: {
			version: "0.6.0",
			releaseNote: "Release notes",
			assetFileName: "Vetta-0.6.0.exe",
			totalBytes: 1_000,
		},
	};
	return engine;
}

describe("UpdaterService", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("maps an available electron-updater release to the existing state contract", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate);

		await service.check();

		expect(service.getState()).toMatchObject({
			phase: "available",
			currentVersion: "0.5.21",
			latestVersion: "0.6.0",
			releaseNote: "Release notes",
			assetFileName: "Vetta-0.6.0.exe",
			totalBytes: 1_000,
		});
	});

	it("surfaces missing update configuration as an actionable check error", async () => {
		const service = new UpdaterService(new FakeUpdateEngine(), "1.1.9", true, translate);

		await service.check();

		expect(service.getState()).toMatchObject({
			phase: "error",
			error: "updater.errors.configurationUnavailable",
		});
	});

	it("surfaces a rejected update check instead of reporting the app as up to date", async () => {
		const engine = new FakeUpdateEngine();
		engine.checkForUpdates = async () => {
			throw new Error("feed unavailable");
		};
		const service = new UpdaterService(engine, "1.1.9", true, translate);

		await service.check();

		expect(service.getState()).toMatchObject({
			phase: "error",
			error: "updater.errors.checkFailed",
		});
	});

	it("reports progress and marks the downloaded update ready", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate);
		await service.check();

		const downloadPromise = service.startDownload();
		engine.emitProgress({
			bytesPerSecond: 100,
			delta: 500,
			percent: 50,
			total: 1_000,
			transferred: 500,
		});
		expect(service.getState()).toMatchObject({
			phase: "downloading",
			progress: 0.5,
			downloadedBytes: 500,
		});

		engine.completeDownload(["C:\\updates\\Vetta-0.6.0.exe"]);
		await downloadPromise;

		expect(service.getState()).toMatchObject({
			phase: "ready",
			progress: 1,
		});
		await service.install();
		expect(engine.installCalls).toBe(1);
	});

	it("cancels an active download without surfacing a download error", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate);
		await service.check();
		void service.startDownload();

		service.cancel();

		expect(engine.cancelCalls).toBe(1);
		expect(service.getState()).toMatchObject({
			phase: "idle",
			error: undefined,
		});
	});

	it("cancels a stalled download and allows the user to retry", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			downloadStallTimeoutMs: 1_000,
		});
		await service.check();
		void service.startDownload();

		await vi.advanceTimersByTimeAsync(900);
		engine.emitProgress({
			bytesPerSecond: 100,
			delta: 100,
			percent: 10,
			total: 1_000,
			transferred: 100,
		});
		await vi.advanceTimersByTimeAsync(900);
		expect(engine.cancelCalls).toBe(0);

		await vi.advanceTimersByTimeAsync(100);
		expect(engine.cancelCalls).toBe(1);
		expect(service.getState()).toMatchObject({
			phase: "error",
			progress: undefined,
			error: "updater.errors.downloadFailed",
		});
	});

	it("does not treat Squirrel.Mac staging as a stalled download", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			downloadStallTimeoutMs: 1_000,
			stagingTimeoutMs: 10_000,
		});
		await service.check();
		const downloadPromise = service.startDownload();

		// 引擎把网络阶段压缩到 0～90%，暂存期间进度停在这里不再变化。
		engine.emitProgress({
			bytesPerSecond: 100,
			delta: 1_000,
			percent: 90,
			total: 1_000,
			transferred: 1_000,
		});
		engine.emitStaging();
		expect(service.getState()).toMatchObject({
			phase: "downloading",
			progress: 0.9,
			downloadedBytes: 1_000,
		});

		// 暂存期间没有任何进度事件，短停滞超时不得触发。
		await vi.advanceTimersByTimeAsync(5_000);
		expect(engine.cancelCalls).toBe(0);
		expect(service.getState().phase).toBe("downloading");

		engine.completeDownload(["/Applications/567 Agent.app"]);
		await downloadPromise;
		expect(service.getState().phase).toBe("ready");
	});

	it("gives up when Squirrel.Mac never finishes staging", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			downloadStallTimeoutMs: 1_000,
			stagingTimeoutMs: 10_000,
		});
		await service.check();
		void service.startDownload();

		engine.emitStaging();
		await vi.advanceTimersByTimeAsync(10_000);

		expect(engine.cancelCalls).toBe(1);
		expect(service.getState()).toMatchObject({
			phase: "error",
			error: "updater.errors.downloadFailed",
		});
	});

	it("keeps a downloaded update ready when cancel is requested", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate);
		await service.check();
		const downloadPromise = service.startDownload();
		engine.completeDownload(["C:\\updates\\Vetta-0.6.0.exe"]);
		await downloadPromise;

		service.cancel();

		expect(engine.cancelCalls).toBe(0);
		expect(service.getState().phase).toBe("ready");
	});

	it("keeps checking on a schedule while the app stays open", async () => {
		const engine = createUpToDateEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "0.5.21", true, translate, { periodicCheckIntervalMs: 60_000 });

		await service.onAppReady();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(checkSpy).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(60_000);
		expect(checkSpy).toHaveBeenCalledTimes(3);

		service.dispose();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(checkSpy).toHaveBeenCalledTimes(3);
	});

	it("does not re-check while an update is already available or downloading", async () => {
		const engine = createAvailableEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			autoDownloadDelayMs: 10_000_000,
			periodicCheckIntervalMs: 60_000,
		});

		await service.onAppReady();
		await vi.advanceTimersByTimeAsync(0);
		expect(service.getState().phase).toBe("available");

		await vi.advanceTimersByTimeAsync(180_000);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		service.dispose();
	});

	it("checks again after the machine wakes from sleep", async () => {
		const engine = createUpToDateEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const resume = createResumeEvents();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			periodicCheckIntervalMs: 600_000,
			backgroundCheckMinGapMs: 60_000,
			systemEvents: resume.events,
		});

		await service.onAppReady();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		// 距离上一次检查太近的唤醒（合盖再开、切换电源）不应重复请求更新源。
		await vi.advanceTimersByTimeAsync(30_000);
		resume.emit();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(60_000);
		resume.emit();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(2);

		// 唤醒补查后周期重新对齐，补查之后的一个完整间隔才再查一次。
		await vi.advanceTimersByTimeAsync(599_000);
		expect(checkSpy).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1_000);
		expect(checkSpy).toHaveBeenCalledTimes(3);

		service.dispose();
		expect(resume.listenerCount()).toBe(0);
	});

	it("syncs opportunistically when the user opens the settings menu", async () => {
		const engine = createUpToDateEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			backgroundCheckMinGapMs: 60_000,
			periodicCheckIntervalMs: 600_000,
		});

		await service.onAppReady();
		await vi.advanceTimersByTimeAsync(0);
		expect(checkSpy).toHaveBeenCalledTimes(1);

		// 反复开合菜单不应反复请求更新源。
		await service.syncInBackground();
		await service.syncInBackground();
		expect(checkSpy).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(60_000);
		await service.syncInBackground();
		expect(checkSpy).toHaveBeenCalledTimes(2);

		service.dispose();
	});

	it("does not sync in the background while a download is in flight", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			backgroundCheckMinGapMs: 0,
			periodicCheckIntervalMs: 0,
		});
		await service.check();
		void service.startDownload();
		expect(service.getState().phase).toBe("downloading");

		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		await service.syncInBackground();

		expect(checkSpy).not.toHaveBeenCalled();
		expect(service.getState().phase).toBe("downloading");
		service.cancel();
		service.dispose();
	});

	it("does not check update feeds in development mode", async () => {
		const engine = createAvailableEngine();
		const checkSpy = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "0.5.21", false, translate);

		await service.check();

		expect(checkSpy).not.toHaveBeenCalled();
		expect(service.getState()).toMatchObject({
			phase: "error",
			error: "updater.errors.developmentUnsupported",
		});
	});
});

it("respects manual-only checks at startup, resume and timer while allowing an explicit check", async () => {
	const engine = createUpToDateEngine();
	const check = vi.spyOn(engine, "checkForUpdates");
	const service = new UpdaterService(engine, "0.5.21", true, translate, {
		preferences: { automaticCheck: false, checkIntervalMinutes: 30, automaticDownload: false, showReminder: false },
	});
	await service.onAppReady();
	await service.syncInBackground();
	expect(check).not.toHaveBeenCalled();
	await service.check();
	expect(check).toHaveBeenCalledOnce();
	service.dispose();
});

describe("saved update preferences", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});
	it("keeps an available update for manual download and never installs without an explicit action", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "0.5.21", true, translate, {
			preferences: { automaticCheck: true, checkIntervalMinutes: 30, automaticDownload: false, showReminder: false },
		});
		await service.check();
		await vi.advanceTimersByTimeAsync(120_000);
		expect(service.getState()).toMatchObject({ phase: "available", showReminder: false });
		const download = service.startDownload();
		expect(service.getState().phase).toBe("downloading");
		await service.check();
		expect(service.getState().phase).toBe("downloading");
		engine.completeDownload(["update.exe"]);
		await download;
		expect(service.getState().phase).toBe("ready");
		expect(engine.installCalls).toBe(0);
		service.dispose();
	});
	it("applies saved preferences immediately but preserves the old choices when saving fails", async () => {
		const engine = createUpToDateEngine();
		const check = vi.spyOn(engine, "checkForUpdates");
		const save = vi.fn(async () => {});
		const service = new UpdaterService(engine, "0.5.21", true, translate, { savePreferences: save });
		await service.onAppReady();
		await service.check();
		await service.setPreferences({
			automaticCheck: false,
			checkIntervalMinutes: 30,
			automaticDownload: false,
			showReminder: false,
		});
		check.mockClear();
		await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
		await service.syncInBackground();
		expect(check).not.toHaveBeenCalled();
		save.mockRejectedValueOnce(new Error("disk full"));
		await expect(service.setPreferences({ ...service.getPreferences(), automaticCheck: true })).rejects.toThrow(
			"disk full",
		);
		expect(service.getPreferences().automaticCheck).toBe(false);
		await service.check();
		expect(check).toHaveBeenCalledOnce();
		service.dispose();
	});
	it("respects a 24 hour preference when resuming after one hour", async () => {
		const engine = createUpToDateEngine();
		const check = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "1.5.1", true, translate, {
			preferences: {
				automaticCheck: true,
				checkIntervalMinutes: 1440,
				automaticDownload: false,
				showReminder: true,
			},
		});
		await service.onAppReady();
		await service.check();
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		await service.syncInBackground();
		expect(check).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(23 * 60 * 60_000);
		expect(check).toHaveBeenCalledTimes(2);
		service.dispose();
	});
	it("reschedules the next automatic check after a manual check", async () => {
		const engine = createUpToDateEngine();
		const check = vi.spyOn(engine, "checkForUpdates");
		const service = new UpdaterService(engine, "1.5.1", true, translate, {
			preferences: { automaticCheck: true, checkIntervalMinutes: 30, automaticDownload: false, showReminder: true },
		});
		await service.onAppReady();
		await service.check();
		await vi.advanceTimersByTimeAsync(29 * 60_000);
		await service.check();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(check).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(29 * 60_000);
		expect(check).toHaveBeenCalledTimes(3);
		service.dispose();
	});
	it("ignores old progress after cancellation and during a replacement download", async () => {
		const engine = createAvailableEngine();
		const callbacks: Array<(progress: ProgressInfo) => void> = [];
		const finishes: Array<(paths: string[]) => void> = [];
		engine.downloadUpdate = (callback) => {
			callbacks.push(callback);
			return { promise: new Promise((resolve) => finishes.push(resolve)), cancel: vi.fn() };
		};
		const service = new UpdaterService(engine, "1.5.1", true, translate);
		await service.check();
		const first = service.startDownload();
		service.cancel();
		const progress = { bytesPerSecond: 100, delta: 700, percent: 70, total: 1000, transferred: 700 };
		callbacks[0](progress);
		expect(service.getState()).toMatchObject({ phase: "idle", progress: undefined, downloadedBytes: undefined });
		await service.check();
		const second = service.startDownload();
		callbacks[0](progress);
		expect(service.getState()).toMatchObject({ phase: "downloading", progress: 0, downloadedBytes: 0 });
		expect(callbacks).toHaveLength(1);
		finishes[0]([]);
		await first;
		await vi.waitFor(() => expect(callbacks).toHaveLength(2));
		callbacks[1](progress);
		expect(service.getState().progress).toBe(0.7);
		finishes[1](["update.deb"]);
		await Promise.all([first, second]);
		service.dispose();
	});
	it.each(["cancel", "dispose"] as const)("does not revive a check after %s", async (action) => {
		const engine = createAvailableEngine();
		let finish!: (result: UpdateEngineCheckResult) => void;
		engine.checkForUpdates = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const download = vi.spyOn(engine, "downloadUpdate");
		const service = new UpdaterService(engine, "1.5.1", true, translate);
		const checking = service.check();
		service[action]();
		finish(engine.checkResult!);
		await checking;
		await vi.advanceTimersByTimeAsync(30_000);
		expect(download).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		if (action === "cancel") expect(service.getState().phase).toBe("idle");
		service.dispose();
	});
	it("turns a synchronous download failure into a retryable error", async () => {
		const engine = createAvailableEngine();
		engine.downloadUpdate = () => {
			throw new Error("download unavailable");
		};
		const service = new UpdaterService(engine, "1.5.1", true, translate);
		await service.check();
		await expect(service.startDownload()).resolves.toMatchObject({
			phase: "error",
			error: "updater.errors.downloadFailed",
		});
		service.dispose();
	});
	it("reports an installation failure instead of leaving the view installing", async () => {
		const engine = createAvailableEngine();
		engine.quitAndInstall = async () => {
			throw new Error("installer unavailable");
		};
		const service = new UpdaterService(engine, "1.5.1", true, translate);
		await service.check();
		const pending = service.startDownload();
		engine.completeDownload(["update.deb"]);
		await pending;
		await service.install();
		expect(service.getState()).toMatchObject({ phase: "error", error: "updater.errors.installFailed" });
		service.dispose();
	});
	it("does not restart its periodic timer after disposing an in-flight scheduled check", async () => {
		const engine = createUpToDateEngine();
		let finish!: (result: UpdateEngineCheckResult) => void;
		const service = new UpdaterService(engine, "1.5.1", true, translate, { periodicCheckIntervalMs: 1000 });
		await service.onAppReady();
		await service.check();
		engine.checkForUpdates = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		await vi.advanceTimersByTimeAsync(1000);
		service.dispose();
		finish(engine.checkResult!);
		await vi.advanceTimersByTimeAsync(0);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("cancels active work and subscriptions when disposed during a download", async () => {
		const engine = createAvailableEngine();
		const resume = createResumeEvents();
		const service = new UpdaterService(engine, "1.5.1", true, translate, { systemEvents: resume.events });
		await service.onAppReady();
		await service.check();
		const pending = service.startDownload();
		const state = service.getState();
		service.dispose();
		engine.emitProgress({ bytesPerSecond: 100, delta: 100, percent: 10, total: 1000, transferred: 100 });
		engine.completeDownload(["old-update.deb"]);
		await pending;
		expect(engine.cancelCalls).toBe(1);
		expect(resume.listenerCount()).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
		expect(service.getState()).toEqual(state);
	});
	it("waits for a manual recheck before downloading its newly selected release", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "1.5.1", true, translate);
		await service.check();
		let finish!: (result: UpdateEngineCheckResult) => void;
		engine.checkForUpdates = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const download = vi.spyOn(engine, "downloadUpdate");
		const checking = service.check();
		const pending = service.startDownload();
		expect(download).not.toHaveBeenCalled();
		finish({ hasUpdate: true, info: { version: "1.5.3" } });
		await checking;
		engine.completeDownload(["new-update.deb"]);
		await pending;
		expect(download).toHaveBeenCalledOnce();
		expect(service.getState()).toMatchObject({ phase: "ready", latestVersion: "1.5.3" });
		service.dispose();
	});
	it("ignores nonfinite progress without breaking the remaining stall timeout", async () => {
		const engine = createAvailableEngine();
		const service = new UpdaterService(engine, "1.5.1", true, translate, { downloadStallTimeoutMs: 1000 });
		await service.check();
		const pending = service.startDownload();
		engine.emitProgress({ bytesPerSecond: 100, delta: 0, percent: Number.NaN, total: 1000, transferred: 0 });
		expect(service.getState().progress).toBe(0);
		engine.emitProgress({ bytesPerSecond: Number.NaN, delta: 0, percent: 10, total: 1000, transferred: 100 });
		expect(service.getState()).toMatchObject({ progress: 0.1, bytesPerSecond: 0 });
		await vi.advanceTimersByTimeAsync(1000);
		expect(service.getState().phase).toBe("error");
		engine.completeDownload([]);
		await pending;
		service.dispose();
	});
});

it("a user pauses a download and resumes without losing the selected release or accepting late progress", async () => {
	const engine = createAvailableEngine();
	const starts = vi.spyOn(engine, "downloadUpdate");
	const service = new UpdaterService(engine, "0.5.21", true, translate, {
		preferences: { automaticCheck: false, automaticDownload: false, checkIntervalMinutes: 120, showReminder: true },
	});
	await service.check();
	const first = service.startDownload();
	engine.emitProgress({ total: 1000, transferred: 400, delta: 400, percent: 40, bytesPerSecond: 100 });
	service.pauseDownload();
	expect(service.getState()).toMatchObject({ phase: "available", paused: true, latestVersion: "0.6.0" });
	engine.emitProgress({ total: 1000, transferred: 800, delta: 400, percent: 80, bytesPerSecond: 100 });
	const resumed = service.startDownload();
	expect(service.getState()).toMatchObject({ phase: "downloading", paused: false });
	// The second attempt cannot touch installer files while the cancelled engine is still cleaning up.
	expect(starts).toHaveBeenCalledTimes(1);
	engine.completeDownload(["late.exe"]);
	await first;
	expect(starts).toHaveBeenCalledTimes(2);
	expect(service.getState()).toMatchObject({ phase: "downloading", paused: false });
	engine.completeDownload(["verified.exe"]);
	await resumed;
	expect(service.getState()).toMatchObject({ phase: "ready", latestVersion: "0.6.0" });
	service.dispose();
});
