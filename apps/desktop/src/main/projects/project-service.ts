import type { DesktopConfig, DesktopConfigUpdater, ProjectEntry } from "../config/desktop-config-store.js";
import { sameProjectPath } from "./project-path.js";

export interface ProjectServiceDependencies {
	readonly allowProjectRoot: (path: string) => void;
	readonly createDirectory: (path: string) => Promise<void>;
	readonly readConfig: () => Promise<DesktopConfig>;
	readonly updateConfig: DesktopConfigUpdater;
	/**
	 * 项目列表落盘后通知渲染进程重读。写入与广播必须成对，否则侧边栏会停在旧快照上
	 * （插件/Action 改完项目要等重启才可见），所以统一走 {@link ProjectService.commit}。
	 */
	readonly broadcastChanged: () => void;
	/**
	 * 这个路径当前是不是一个**已存在的非目录**（文件、软链等）。用于挡住「把文件注册成
	 * 项目」——不存在的路径仍然放行，`open` 本来就允许登记一个还没建出来的目录。
	 */
	readonly isExistingNonDirectory: (path: string) => Promise<boolean>;
}

export interface ProjectListSnapshot {
	readonly workspacePath: string;
	readonly projects: readonly ProjectEntry[];
	readonly archivedProjects: readonly ProjectEntry[];
}

function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function joinPath(base: string, name: string): string {
	const separator = base.includes("\\") ? "\\" : "/";
	return `${base.replace(/[\\/]+$/, "")}${separator}${name}`;
}

function pathBasename(path: string): string {
	const normalized = path.replace(/[\\/]+$/, "");
	const parts = normalized.split(/[\\/]/);
	return parts[parts.length - 1] || path;
}

function findProject(entries: readonly ProjectEntry[], path: string): ProjectEntry | undefined {
	return entries.find((entry) => sameProjectPath(entry.path, path));
}

function assertProjectName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length === 0 || trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
		throw new Error("Invalid project name.");
	}
	return trimmed;
}

export class ProjectService {
	constructor(private readonly dependencies: ProjectServiceDependencies) {}

	/** 唯一的写路径：落盘 + 广播。任何改动项目列表的地方都必须经由它。 */
	private async commit(mutate: (config: DesktopConfig) => DesktopConfig): Promise<DesktopConfig> {
		let changed = false;
		const config = await this.dependencies.updateConfig((current) => {
			const next = mutate(current);
			changed = next !== current;
			return next;
		});
		if (changed) this.dependencies.broadcastChanged();
		return config;
	}

	async list(): Promise<ProjectListSnapshot> {
		const config = await this.dependencies.readConfig();
		return {
			workspacePath: config.workspacePath,
			projects: config.projects.map((entry) => ({ ...entry })),
			archivedProjects: config.archivedProjects.map((entry) => ({ ...entry })),
		};
	}

	async create(name: string, path?: string): Promise<ProjectEntry> {
		const normalizedName = assertProjectName(name);
		const config = await this.dependencies.readConfig();
		const projectPath = path?.trim() ? path.trim() : joinPath(config.workspacePath, normalizedName);
		if (!isAbsolutePath(projectPath)) throw new Error("Project path must be absolute.");

		await this.dependencies.createDirectory(projectPath);
		await this.commit((current) => {
			if (findProject(current.projects, projectPath) || findProject(current.archivedProjects, projectPath))
				return current;
			return { ...current, projects: [...current.projects, { path: projectPath, name: normalizedName }] };
		});
		this.dependencies.allowProjectRoot(projectPath);
		return { path: projectPath, name: normalizedName };
	}

	async open(path: string, name?: string): Promise<ProjectEntry> {
		if (!isAbsolutePath(path)) throw new Error("Project path must be absolute.");
		// 项目必须是目录。放进来一个文件不会当场报错，而是等到有人去 readdir 它时才炸
		// （ENOTDIR），且从此每次扫描都炸一次——现场就出现过一个 v1 时代的 `x.vetd`
		// **文件**被登记成项目，之后每轮项目扫描都刷一条主进程 error。
		if (await this.dependencies.isExistingNonDirectory(path)) {
			throw new Error("Project path must be a directory.");
		}
		const entry = { path, name: name?.trim() || pathBasename(path) };
		await this.commit((config) => {
			const projects = config.projects.map((item) => ({ ...item }));
			const archivedProjects = config.archivedProjects.filter((item) => !sameProjectPath(item.path, path));
			if (!findProject(projects, path)) projects.push(entry);
			if (projects.length === config.projects.length && archivedProjects.length === config.archivedProjects.length)
				return config;
			return { ...config, projects, archivedProjects };
		});
		this.dependencies.allowProjectRoot(path);
		return entry;
	}

	async rename(path: string, name: string): Promise<ProjectEntry> {
		const updated = await this.commit((config) => {
			const projects = config.projects.map((entry) => ({ ...entry }));
			const archivedProjects = config.archivedProjects.map((entry) => ({ ...entry }));
			const renamed = findProject(projects, path) ?? findProject(archivedProjects, path);
			if (!renamed) throw new Error(`Project not found: ${path}`);
			if (renamed.name === name) return config;
			renamed.name = name;
			return { ...config, projects, archivedProjects };
		});
		const renamed = findProject(updated.projects, path) ?? findProject(updated.archivedProjects, path);
		if (!renamed) throw new Error(`Project not found: ${path}`);
		return { ...renamed };
	}

	async archive(path: string): Promise<void> {
		await this.commit((config) => {
			const entry = findProject(config.projects, path);
			if (!entry) throw new Error(`Active project not found: ${path}`);
			const projects = config.projects.filter((item) => !sameProjectPath(item.path, path));
			const archivedProjects = config.archivedProjects.map((item) => ({ ...item }));
			if (!findProject(archivedProjects, path)) archivedProjects.push({ ...entry });
			return { ...config, projects, archivedProjects };
		});
	}

	async unarchive(path: string): Promise<void> {
		await this.commit((config) => {
			const entry = findProject(config.archivedProjects, path);
			if (!entry) throw new Error(`Archived project not found: ${path}`);
			const archivedProjects = config.archivedProjects.filter((item) => !sameProjectPath(item.path, path));
			const projects = config.projects.map((item) => ({ ...item }));
			if (!findProject(projects, path)) projects.push({ ...entry });
			return { ...config, projects, archivedProjects };
		});
		this.dependencies.allowProjectRoot(path);
	}

	async remove(path: string): Promise<void> {
		await this.commit((config) => {
			const projects = config.projects.filter((item) => !sameProjectPath(item.path, path));
			const archivedProjects = config.archivedProjects.filter((item) => !sameProjectPath(item.path, path));
			if (projects.length === config.projects.length && archivedProjects.length === config.archivedProjects.length) {
				throw new Error(`Project not found: ${path}`);
			}
			return { ...config, projects, archivedProjects };
		});
	}
}
