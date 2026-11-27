import type { SshHostInput } from "@567agent/ssh-transport";
import {
	BrowserWindow,
	dialog,
	ipcMain,
	type WebContents,
	type WebContentsDidStartNavigationEventParams,
} from "electron";
import { SSH_CHANNELS } from "../../shared/ssh-ipc.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { mainT } from "../i18n/messages.js";
import { getSshPortForwardService } from "../ssh/port-forward-service.js";
import { probeSshHost } from "../ssh/ssh-host-probe.js";
import { SshHostRebindError } from "../ssh/ssh-host-service.js";
import { getSshHostService, listSshConfigAliases } from "../ssh/ssh-host-service-instance.js";
import { SshPrivateKeyError, SshPrivateKeyPicker } from "../ssh/ssh-private-key.js";
import { sshCredentialRef } from "../ssh/ssh-prompt-service.js";
import { getSshConnection, getSshHostStatus } from "../ssh/ssh-runtime.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

const CHANNELS = {
	PICK_PRIVATE_KEY: SSH_CHANNELS.PICK_PRIVATE_KEY,
	DISCARD_PRIVATE_KEY: SSH_CHANNELS.DISCARD_PRIVATE_KEY,
	LIST_HOSTS: "vetta:ssh:list-hosts",
	CREATE_HOST: "vetta:ssh:create-host",
	UPDATE_HOST: "vetta:ssh:update-host",
	REMOVE_HOST: "vetta:ssh:remove-host",
	REBIND_HOST: "vetta:ssh:rebind-host",
	IMPORT_CONFIG: "vetta:ssh:import-config",
	LIST_CONFIG_ALIASES: "vetta:ssh:list-config-aliases",
	TEST_HOST: "vetta:ssh:test-host",
	HOST_STATUS: "vetta:ssh:get-host-status",
	LIST_REMOTE_DIR: "vetta:ssh:list-remote-dir",
	LIST_LISTENING_PORTS: "vetta:ssh:list-listening-ports",
	LIST_FORWARDS: "vetta:ssh:list-port-forwards",
	OPEN_FORWARD: "vetta:ssh:open-port-forward",
	CLOSE_FORWARD: "vetta:ssh:close-port-forward",
	TERMINATE_PROCESS: "vetta:ssh:terminate-process",
} as const;

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asPort(value: unknown): number {
	// 端口号的合法区间由服务判定并给出可读错误，这里只负责把非数字挡成一个必然被拒的值。
	return typeof value === "number" ? value : -1;
}

function toHostInput(value: unknown): SshHostInput {
	const raw = (value ?? {}) as Record<string, unknown>;
	return {
		label: asString(raw.label),
		target: asString(raw.target),
		port: typeof raw.port === "number" ? raw.port : undefined,
		identityFile: typeof raw.identityFile === "string" ? raw.identityFile : undefined,
		authMethod: raw.authMethod === "password" ? "password" : "key",
	};
}

/** 口令进加密凭据库；切回私钥登录时把旧口令清掉，不留在磁盘上。 */
function syncHostPassword(hostId: string, authMethod: unknown, password: unknown): void {
	const ref = sshCredentialRef(hostId, "password");
	const vault = getDesktopCredentialVault();
	try {
		if (authMethod !== "password") vault.remove(ref);
		else if (typeof password === "string" && password.length > 0) {
			vault.put(ref, password, { kind: "password", consumer: "ssh" });
		}
	} catch {
		return;
	}
}

export function registerSshIpc(owner: WebContents): () => void {
	const picker = new SshPrivateKeyPicker();
	const clearSelection = () => picker.discard();
	const onNavigation = ({ isMainFrame, isSameDocument }: WebContentsDidStartNavigationEventParams) => {
		if (isMainFrame && !isSameDocument) clearSelection();
	};
	owner.on("did-start-navigation", onNavigation);
	owner.on("render-process-gone", clearSelection);
	owner.on("destroyed", clearSelection);

	const handle = (channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void => {
		ipcMain.handle(channel, async (event, ...args) => {
			assertTrustedMainRenderer(event, owner);
			try {
				return await handler(event, ...args);
			} catch (error) {
				if (error instanceof SshPrivateKeyError) throw new Error(mainT(`ssh.privateKeyErrors.${error.reason}`));
				throw error;
			}
		});
	};
	handle(CHANNELS.PICK_PRIVATE_KEY, () =>
		picker.pick(async () => {
			const parent = BrowserWindow.fromWebContents(owner);
			if (!parent) return undefined;
			const result = await dialog.showOpenDialog(parent, {
				title: mainT("ssh.pickPrivateKey"),
				properties: ["openFile", "showHiddenFiles"],
			});
			return result.canceled ? undefined : result.filePaths[0];
		}),
	);
	handle(CHANNELS.DISCARD_PRIVATE_KEY, (_event, ref: unknown) => picker.discard(asString(ref)));

	handle(CHANNELS.LIST_HOSTS, async () => {
		const hosts = await getSshHostService().list();
		// 状态是运行期信息，不进配置文件；列表一并带上，省得 UI 再逐台问一遍。
		return hosts.map((host) => ({ ...host, status: getSshHostStatus(host.id) }));
	});

	handle(CHANNELS.CREATE_HOST, async (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		const host = toHostInput(raw);
		const service = getSshHostService();
		const created = await (raw.privateKeyRef === undefined
			? service.create(host)
			: picker.save(asString(raw.privateKeyRef), (bytes) => service.create(host, bytes)));
		syncHostPassword(created.id, raw.authMethod, raw.password);
		return created;
	});

	handle(CHANNELS.UPDATE_HOST, async (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		const id = asString(raw.id);
		const host = toHostInput(raw);
		const service = getSshHostService();
		const updated = await (raw.privateKeyRef === undefined
			? service.update(id, host)
			: picker.save(asString(raw.privateKeyRef), (bytes) => service.update(id, host, bytes)));
		syncHostPassword(updated.id, raw.authMethod, raw.password);
		return updated;
	});

	handle(CHANNELS.REMOVE_HOST, async (_event, hostId: unknown) => {
		const id = asString(hostId);
		await getSshHostService().remove(id);
		getDesktopCredentialVault().remove(sshCredentialRef(id, "password"));
		// 主机没了，它的转发也就指不到任何地方；留着只会在端口面板里当一条撤不掉的死条目。
		await getSshPortForwardService().closeHost(id);
	});

	// 结果而非异常：IPC 只把异常的 message 带过去，界面要按拒绝原因给出不同的说明。
	handle(CHANNELS.REBIND_HOST, async (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		const hostId = asString(raw.hostId);
		try {
			const host = await getSshHostService().rebind(hostId, asString(raw.orphanId));
			// 转发账本按 hostId 记账，换了 id 的主机上那些转发再也对不上号。
			await getSshPortForwardService().closeHost(hostId);
			return { ok: true, host };
		} catch (error) {
			if (error instanceof SshHostRebindError) {
				return { ok: false, reason: error.reason, projectCount: error.projectCount };
			}
			throw error;
		}
	});

	handle(CHANNELS.LIST_CONFIG_ALIASES, () => listSshConfigAliases());

	handle(CHANNELS.IMPORT_CONFIG, (_event, aliases: unknown) =>
		getSshHostService().importFromSshConfig(
			Array.isArray(aliases) ? aliases.filter((item): item is string => typeof item === "string") : [],
		),
	);

	handle(CHANNELS.TEST_HOST, (_event, hostId: unknown) => probeSshHost(asString(hostId)));

	handle(CHANNELS.HOST_STATUS, (_event, hostId: unknown) => getSshHostStatus(asString(hostId)));

	// 远端目录浏览器：添加远程项目时用它选目录。
	handle(CHANNELS.LIST_REMOTE_DIR, async (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		const connection = getSshConnection(asString(raw.hostId));
		// 缺省从家目录开始，而不是 `/`——用户的项目几乎总在家目录下。
		const remotePath = await connection.expandRemotePath(asString(raw.remotePath) || "~");
		const entries = await connection.listDirectory(remotePath);
		return { remotePath, entries };
	});

	// 远端正在监听的端口：端口面板据此给出「要不要转发它」的候选。
	handle(CHANNELS.LIST_LISTENING_PORTS, (_event, hostId: unknown) =>
		getSshConnection(asString(hostId)).listListeningPorts(),
	);

	// 端口面板里「停掉这个服务」。pid 由界面从扫描结果里带回来，非法值交给连接层拒绝。
	handle(CHANNELS.TERMINATE_PROCESS, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getSshConnection(asString(raw.hostId)).terminateProcess(typeof raw.pid === "number" ? raw.pid : -1, {
			force: raw.force === true,
		});
	});

	handle(CHANNELS.LIST_FORWARDS, (_event, hostId: unknown) => {
		const scope = asString(hostId);
		return getSshPortForwardService().list(scope === "" ? undefined : scope);
	});

	handle(CHANNELS.OPEN_FORWARD, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getSshPortForwardService().open({
			hostId: asString(raw.hostId),
			remotePort: asPort(raw.remotePort),
			// 给了就按用户点名的号来，包括「把已有的这条换到这个号上」。
			localPort: typeof raw.localPort === "number" ? raw.localPort : undefined,
			label: typeof raw.label === "string" ? raw.label : undefined,
			source: raw.source === "detected" ? "detected" : "manual",
		});
	});

	handle(CHANNELS.CLOSE_FORWARD, (_event, input: unknown) => {
		const raw = (input ?? {}) as Record<string, unknown>;
		return getSshPortForwardService().close(asString(raw.hostId), asPort(raw.remotePort));
	});

	return () => {
		clearSelection();
		owner.removeListener("did-start-navigation", onNavigation);
		owner.removeListener("render-process-gone", clearSelection);
		owner.removeListener("destroyed", clearSelection);
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
