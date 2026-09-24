import { ipcMain } from "electron";
import { NewApiService } from "./newapi-service.js";

export function register567ApiIpc(): () => void {
	const service = NewApiService.getInstance();

	ipcMain.handle("vetta:567api:get-status", () => {
		return service.getStatus();
	});

	ipcMain.handle("vetta:567api:get-groups", async (_event, force?: unknown) => {
		return service.getAvailableGroups(force === true);
	});

	ipcMain.handle("vetta:567api:sync-group", async (_event, groupName: unknown) => {
		if (typeof groupName !== "string" || !groupName.trim()) {
			return { success: false, message: "分组名称格式错误" };
		}
		return service.syncSingleGroup(groupName.trim());
	});

	ipcMain.handle("vetta:567api:remove-group", async (_event, groupName: unknown) => {
		if (typeof groupName !== "string" || !groupName.trim()) {
			return { success: false, message: "分组名称格式错误" };
		}
		return service.removeGroup(groupName.trim());
	});

	ipcMain.handle("vetta:567api:set-active-group", async (_event, groupName: unknown) => {
		if (typeof groupName !== "string" || !groupName.trim()) {
			return { success: false, message: "分组名称格式错误" };
		}
		return service.setActiveGroup(groupName.trim());
	});

	ipcMain.handle("vetta:567api:set-image-group", async (_event, groupName: unknown) => {
		if (typeof groupName !== "string" || !groupName.trim()) {
			return { success: false, message: "分组名称格式错误" };
		}
		return service.setImageGroup(groupName.trim());
	});

	ipcMain.handle("vetta:567api:set-image-model", async (_event, modelName: unknown) => {
		if (typeof modelName !== "string" || !modelName.trim()) {
			return { success: false, message: "模型名称格式错误" };
		}
		return service.setImageModel(modelName.trim());
	});

	ipcMain.handle("vetta:567api:refresh-groups", async () => {
		await service.refreshSyncedGroups();
		return { success: true };
	});

	ipcMain.handle("vetta:567api:login-access-token", async (_event, token: unknown) => {
		if (typeof token !== "string") {
			return { success: false, message: "账户访问令牌格式错误" };
		}
		return service.loginWithAccessToken(token);
	});

	ipcMain.handle("vetta:567api:login-password", async (_event, username: unknown, password: unknown) => {
		if (typeof username !== "string" || typeof password !== "string") {
			return { success: false, message: "用户名与密码格式错误" };
		}
		return service.loginWithPassword(username, password);
	});

	ipcMain.handle("vetta:567api:login", async (_event, username: unknown, password: unknown) => {
		if (typeof username !== "string" || typeof password !== "string") {
			return { success: false, message: "用户名与密码格式错误" };
		}
		return service.loginWithPassword(username, password);
	});

	ipcMain.handle("vetta:567api:bind-token", async (_event, token: unknown) => {
		if (typeof token !== "string") {
			return { success: false, message: "令牌格式错误" };
		}
		return service.loginWithAccessToken(token);
	});

	ipcMain.handle("vetta:567api:refresh-quota", async (_event, force?: unknown) => {
		return service.refreshQuota(force === true);
	});

	ipcMain.handle("vetta:567api:logout", async () => {
		await service.logout();
		return { success: true };
	});

	return () => {
		ipcMain.removeHandler("vetta:567api:get-status");
		ipcMain.removeHandler("vetta:567api:get-groups");
		ipcMain.removeHandler("vetta:567api:sync-group");
		ipcMain.removeHandler("vetta:567api:remove-group");
		ipcMain.removeHandler("vetta:567api:set-active-group");
		ipcMain.removeHandler("vetta:567api:set-image-group");
		ipcMain.removeHandler("vetta:567api:set-image-model");
		ipcMain.removeHandler("vetta:567api:refresh-groups");
		ipcMain.removeHandler("vetta:567api:login-access-token");
		ipcMain.removeHandler("vetta:567api:login-password");
		ipcMain.removeHandler("vetta:567api:login");
		ipcMain.removeHandler("vetta:567api:bind-token");
		ipcMain.removeHandler("vetta:567api:refresh-quota");
		ipcMain.removeHandler("vetta:567api:logout");
	};
}
