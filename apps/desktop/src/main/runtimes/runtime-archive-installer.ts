import { spawnSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { RuntimeType } from "./paths.js";
import { probeManagedRuntime } from "./runtime-health.js";

export interface RuntimeArchiveInstallOptions {
	runtimeType: RuntimeType;
	archivePath: string;
	archiveType: "tar.gz" | "zip";
	innerDirectory: string;
	targetDirectory: string;
	executablePath: string;
	expectedVersion: string;
}

export interface RuntimeDirectoryInstallOptions {
	runtimeType: RuntimeType;
	sourceDirectory: string;
	targetDirectory: string;
	executablePath: string;
	expectedVersion: string;
}

export class RuntimeInstallInUseError extends Error {
	constructor(cause: unknown) {
		super("Runtime files are in use or the runtime directory is not writable", { cause });
	}
}

async function renameRuntimeDirectory(source: string, destination: string): Promise<void> {
	// A completed health probe can leave a short-lived executable lock on Windows.
	// Keep replacement atomic; persistent locks still fail with the original error.
	for (let attempt = 0; ; attempt++) {
		try {
			await rename(source, destination);
			return;
		} catch (error) {
			if (
				attempt >= 5 ||
				!(error instanceof Error) ||
				!("code" in error) ||
				!["EPERM", "EACCES", "EBUSY"].includes(String(error.code))
			) {
				throw error;
			}
			await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
		}
	}
}

function extractArchive(archivePath: string, destination: string, archiveType: string): void {
	// Windows 10+ 的 bsdtar 与 Unix tar 都支持项目使用的 tar.gz；Windows
	// bsdtar 同时支持 Node 官方发布的 zip。
	const result = spawnSync("tar", ["-xf", archivePath, "-C", destination], {
		encoding: "utf-8",
		timeout: 180_000,
	});
	if (result.status !== 0) {
		throw new Error(
			`${archiveType} extract failed: ${result.stderr || result.stdout || result.error?.message || "unknown error"}`,
		);
	}
}

/**
 * 先把运行时准备到同盘的 staging 目录，验证通过后再原子替换目标。
 * 准备过程失败不会破坏既有运行时。
 */
async function installViaStaging(
	targetDirectory: string,
	stagingPrefix: string,
	prepare: (stagingDirectory: string) => Promise<string>,
	validate: (preparedDirectory: string) => void,
): Promise<void> {
	const targetParent = dirname(targetDirectory);
	await mkdir(targetParent, { recursive: true });
	const stagingDirectory = await mkdtemp(join(targetParent, `.${basename(targetDirectory)}-${stagingPrefix}-`));
	const previousDirectory = join(stagingDirectory, "previous");
	let preservePrevious = false;

	try {
		const preparedDirectory = await prepare(stagingDirectory);
		const preparedInfo = await stat(preparedDirectory).catch(() => undefined);
		if (!preparedInfo?.isDirectory()) {
			throw new Error(`runtime payload is missing directory: ${preparedDirectory}`);
		}
		validate(preparedDirectory);

		// Never recursively delete the active runtime: Windows can remove npm files
		// before reaching a locked node.exe, leaving a misleadingly runnable shell.
		const hadPrevious = existsSync(targetDirectory);
		if (hadPrevious) {
			try {
				await renameRuntimeDirectory(targetDirectory, previousDirectory);
			} catch (error) {
				if (
					error instanceof Error &&
					"code" in error &&
					["EPERM", "EACCES", "EBUSY"].includes(String(error.code))
				) {
					throw new RuntimeInstallInUseError(error);
				}
				throw error;
			}
		}
		try {
			await renameRuntimeDirectory(preparedDirectory, targetDirectory);
		} catch (error) {
			if (hadPrevious) {
				try {
					await renameRuntimeDirectory(previousDirectory, targetDirectory);
				} catch (restoreError) {
					preservePrevious = true;
					throw new AggregateError(
						[error, restoreError],
						`Runtime replacement failed; previous files retained at ${previousDirectory}`,
					);
				}
			}
			throw error;
		}
	} finally {
		if (!preservePrevious && existsSync(stagingDirectory)) {
			// Running processes may still hold the retired runtime. Cleanup failure
			// does not invalidate the newly verified installation.
			await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined);
		}
	}
}

export async function installRuntimeArchive(options: RuntimeArchiveInstallOptions): Promise<void> {
	await installViaStaging(
		options.targetDirectory,
		"extract",
		async (stagingDirectory) => {
			extractArchive(options.archivePath, stagingDirectory, options.archiveType);
			return join(stagingDirectory, options.innerDirectory);
		},
		(preparedDirectory) => validateRuntimePayload(options, preparedDirectory),
	);
}

/**
 * 从已解压的内置目录安装（macOS 专用形态）。macOS 的 vendor 运行时必须以解压
 * 目录内置，归档里的 Mach-O 签不到名、过不了公证，详见 docs/desktop/macos-auto-update.md。
 * 复制保留符号链接与权限位，因此二进制上的代码签名不受影响。
 */
export async function installRuntimeDirectory(options: RuntimeDirectoryInstallOptions): Promise<void> {
	await installViaStaging(
		options.targetDirectory,
		"copy",
		async (stagingDirectory) => {
			const preparedDirectory = join(stagingDirectory, "payload");
			// verbatimSymlinks 不可省：默认会把相对链接（python3 -> python3.13）重写成
			// 指向源目录的绝对路径，安装后就指回了 app bundle 内部，更新替换 .app 时悬空。
			await cp(options.sourceDirectory, preparedDirectory, {
				recursive: true,
				preserveTimestamps: true,
				verbatimSymlinks: true,
			});
			return preparedDirectory;
		},
		(preparedDirectory) => validateRuntimePayload(options, preparedDirectory),
	);
}

function validateRuntimePayload(
	options: Pick<
		RuntimeArchiveInstallOptions | RuntimeDirectoryInstallOptions,
		"runtimeType" | "executablePath" | "expectedVersion" | "targetDirectory"
	>,
	preparedDirectory: string,
): void {
	const executablePath = join(preparedDirectory, relative(options.targetDirectory, options.executablePath));
	if (process.platform !== "win32") {
		try {
			chmodSync(executablePath, 0o755);
		} catch {
			// The health probe below reports a useful failure while preserving the old install.
		}
	}
	const health = probeManagedRuntime(options.runtimeType, executablePath, options.expectedVersion);
	if (!health.ready) {
		throw new Error(
			`runtime health check failed (${options.expectedVersion}): ${health.error ?? "version mismatch"}`,
		);
	}
}
