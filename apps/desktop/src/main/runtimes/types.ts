import type { RuntimeInstallProgress } from "../../shared/runtime-install-progress.js";
import type { RuntimeType } from "./paths.js";

export type { RuntimeType };
export type { RuntimeInstallProgress };

/** 运行时来源:内置拷贝 / 下载 / 复用系统。 */
export type RuntimeSource = "managed" | "system";

/** 单个运行时的对外状态(给 IPC / 设置面板)。 */
export interface RuntimeStatus {
	type: RuntimeType;
	/** 托管版是否就绪(版本与清单一致；Node 还需有完整、可运行的 npm)。 */
	ready: boolean;
	/** 文件占用导致修复未完成；下次启动需先恢复运行时。 */
	repairRequiresRestart?: boolean;
	/** 推荐(目标)版本。 */
	recommendedVersion: string;
	/** 托管版实际版本(就绪时)。 */
	managedVersion?: string;
	/** 托管可执行文件路径(就绪时)。 */
	executablePath?: string;
	/** 注入 PATH 后实际生效的来源。当前恒为 managed(优先托管版,见 ADR-0011)。 */
	activeSource: RuntimeSource;
	/** 系统探测到的同名运行时(仅展示/兜底,不参与 PATH 优先级)。 */
	system?: { path: string; version: string };
	/** 当前平台是否被 manifest 支持。 */
	supported: boolean;
}

export interface RuntimesStatus {
	node: RuntimeStatus;
	python: RuntimeStatus;
	/** 注入到 bash 子进程的镜像源(展示用)。 */
	mirrors: { npmRegistry: string; pipIndexUrl: string };
}

interface RegistryEntry {
	source: RuntimeSource;
	version: string;
	executablePath: string;
	installPath: string;
	installedAt: number;
	verified: boolean;
}

/** ~/.567agent/runtimes/.cache/registry.json 的形状。 */
export interface RuntimeRegistryData {
	version: 1;
	pendingRepairs?: RuntimeType[];
	binaries: Partial<Record<RuntimeType, RegistryEntry>>;
	systemDetection: Partial<Record<RuntimeType, { path: string; version: string; detectedAt: number }>>;
}
