import { ipcMain, type WebContents } from "electron";
import { getDesktopProjectService } from "../projects/project-service-instance.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

const CHANNELS = {
	LIST: "vetta:projects:list",
	CREATE: "vetta:projects:create",
	OPEN: "vetta:projects:open",
	RENAME: "vetta:projects:rename",
	ARCHIVE: "vetta:projects:archive",
	UNARCHIVE: "vetta:projects:unarchive",
	REMOVE: "vetta:projects:remove",
} as const;

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * 项目增删改查的渲染进程入口。
 *
 * 渲染进程此前自己 `config.get()` → 改数组 → `config.set()`，与插件/Action 走的
 * ProjectService 形成两条并行写路径：校验（绝对路径、必须是目录）只有后者做，
 * 变更广播也只有后者发。这里把渲染进程接回同一个服务，写入只剩一条路径。
 */
export function registerProjectsIpc(owner: WebContents): () => void {
	const handle = (channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void => {
		ipcMain.handle(channel, (event, ...args) => {
			assertTrustedMainRenderer(event, owner);
			return handler(event, ...args);
		});
	};
	handle(CHANNELS.LIST, () => getDesktopProjectService().list());

	handle(CHANNELS.CREATE, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getDesktopProjectService().create(asString(raw.name), asOptionalString(raw.path));
	});

	handle(CHANNELS.OPEN, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getDesktopProjectService().open(asString(raw.path), asOptionalString(raw.name));
	});

	handle(CHANNELS.RENAME, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getDesktopProjectService().rename(asString(raw.path), asString(raw.name));
	});

	handle(CHANNELS.ARCHIVE, (_event, path: unknown) => getDesktopProjectService().archive(asString(path)));

	handle(CHANNELS.UNARCHIVE, (_event, path: unknown) => getDesktopProjectService().unarchive(asString(path)));

	handle(CHANNELS.REMOVE, (_event, path: unknown) => getDesktopProjectService().remove(asString(path)));

	return () => {
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
