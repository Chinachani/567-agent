import { ipcMain, type WebContents } from "electron";
import { isApi567RouteId } from "../../shared/service-routes.js";
import { mainT } from "../i18n/index.js";
import { assertTrustedMainRenderer } from "../ipc/trusted-renderer.js";
import { NewApiService } from "./newapi-service.js";

export function register567ApiIpc(owner?: WebContents): () => void {
	const service = NewApiService.getInstance();
	if (owner) {
		let reader:
			| Promise<ReturnType<typeof import("../conversations/local-usage-log.js").createLocalUsageReader>>
			| undefined;
		ipcMain.handle("agent567:usage:local", async (event) => {
			assertTrustedMainRenderer(event, owner);
			reader ??= import("../conversations/local-usage-log.js").then((module) => module.createLocalUsageReader());
			const data = await (await reader)();
			const groups = await service.getUsageGroupNames();
			return { ...data, rows: data.rows.map((row) => ({ ...row, group: groups.get(row.provider) })) };
		});
		ipcMain.handle("agent567:usage:billed", (event) => {
			assertTrustedMainRenderer(event, owner);
			return service.readBilledUsage();
		});
	}
	const requests = new Map<string, AbortController>();
	ipcMain.handle("agent567:service-route:refresh", (_event, force: unknown) =>
		service.refreshServiceRoutes(force === true),
	);
	for (const operation of ["probe", "select"] as const) {
		ipcMain.handle(`agent567:service-route:${operation}`, async (event, route: unknown, id: unknown) => {
			if (!isApi567RouteId(route) || typeof id !== "string" || !/^[a-zA-Z0-9-]{1,64}$/.test(id))
				throw new Error("Invalid service route request");
			const key = `${event.sender.id}:${id}`;
			if (requests.has(key) || requests.size >= 20) throw new Error("Too many service route requests");
			const controller = new AbortController();
			requests.set(key, controller);
			const abort = () => controller.abort();
			event.sender.once("destroyed", abort);
			try {
				return await (operation === "probe"
					? service.probeServiceRoute(route, controller.signal)
					: service.selectServiceRoute(route, controller.signal));
			} finally {
				requests.delete(key);
				event.sender.removeListener("destroyed", abort);
			}
		});
	}
	ipcMain.handle("agent567:service-route:cancel", (event, id: unknown) => {
		if (typeof id === "string") requests.get(`${event.sender.id}:${id}`)?.abort();
	});

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

	ipcMain.handle("vetta:567api:set-active-group", async (_event, groupName: unknown, modelName: unknown) => {
		if (typeof groupName !== "string" || !groupName.trim()) {
			return { success: false, message: "分组名称格式错误" };
		}
		if (modelName !== undefined && (typeof modelName !== "string" || !modelName.trim() || modelName.length > 512)) {
			return { success: false, message: mainT("api567Model.invalidName") };
		}
		return service.setActiveGroup(groupName.trim(), typeof modelName === "string" ? modelName.trim() : undefined);
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
		return service.refreshSyncedGroups();
	});

	ipcMain.handle("vetta:567api:refresh-background", async (_event, options?: unknown) => {
		const parsed =
			typeof options === "boolean"
				? { force: options }
				: options && typeof options === "object"
					? {
							force: "force" in options && options.force === true,
							startup: "startup" in options && options.startup === true,
						}
					: {};
		return service.refreshGroupsAndModelsInBackground(parsed);
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

	ipcMain.handle("vetta:567api:send-verification-code", async (_event, email: unknown) => {
		if (typeof email !== "string") {
			return { success: false, message: "邮箱格式错误" };
		}
		return service.sendVerificationCode(email);
	});

	ipcMain.handle("vetta:567api:register", async (_event, params: unknown) => {
		if (!params || typeof params !== "object") {
			return { success: false, message: "注册参数格式错误" };
		}
		const p = params as Record<string, string>;
		return service.register({
			username: String(p.username || ""),
			password: String(p.password || ""),
			email: String(p.email || ""),
			verification_code: String(p.verification_code || ""),
			aff_code: p.aff_code ? String(p.aff_code) : undefined,
		});
	});

	ipcMain.handle("vetta:567api:topup-key", async (_event, key: unknown) => {
		if (typeof key !== "string") {
			return { success: false, message: "卡密格式错误" };
		}
		return service.topupWithKey(key);
	});

	ipcMain.handle("vetta:567api:create-pay-order", async (_event, amount: unknown, method: unknown) => {
		const amt = typeof amount === "number" ? amount : Number(amount);
		const pm = method === "wxpay" ? "wxpay" : "alipay";
		return service.createPayOrder(amt, pm);
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
		if (owner) {
			ipcMain.removeHandler("agent567:usage:billed");
			ipcMain.removeHandler("agent567:usage:local");
		}
		for (const request of requests.values()) request.abort();
		requests.clear();
		for (const operation of ["probe", "select", "cancel", "refresh"])
			ipcMain.removeHandler(`agent567:service-route:${operation}`);
		ipcMain.removeHandler("vetta:567api:get-status");
		ipcMain.removeHandler("vetta:567api:get-groups");
		ipcMain.removeHandler("vetta:567api:sync-group");
		ipcMain.removeHandler("vetta:567api:remove-group");
		ipcMain.removeHandler("vetta:567api:set-active-group");
		ipcMain.removeHandler("vetta:567api:set-image-group");
		ipcMain.removeHandler("vetta:567api:set-image-model");
		ipcMain.removeHandler("vetta:567api:refresh-groups");
		ipcMain.removeHandler("vetta:567api:refresh-background");
		ipcMain.removeHandler("vetta:567api:login-access-token");
		ipcMain.removeHandler("vetta:567api:login-password");
		ipcMain.removeHandler("vetta:567api:login");
		ipcMain.removeHandler("vetta:567api:send-verification-code");
		ipcMain.removeHandler("vetta:567api:register");
		ipcMain.removeHandler("vetta:567api:topup-key");
		ipcMain.removeHandler("vetta:567api:create-pay-order");
		ipcMain.removeHandler("vetta:567api:bind-token");
		ipcMain.removeHandler("vetta:567api:refresh-quota");
		ipcMain.removeHandler("vetta:567api:logout");
	};
}
