import { normalizeSshHostInput, type SshHost, type SshHostInput } from "@567agent/ssh-transport";
import type { StoredSshHost } from "./ssh-host-store.js";
import { SshPrivateKeyError, type SshPrivateKeyStore } from "./ssh-private-key.js";

export interface SshHostServiceDependencies {
	readonly readHosts: () => Promise<StoredSshHost[]>;
	/** 主机列表单独落盘，不经 desktop-config.json（旧版本会把它整份重写掉）。 */
	readonly writeHosts: (hosts: StoredSshHost[]) => Promise<void>;
	readonly privateKeys: SshPrivateKeyStore;
	readonly forgetPassphrase: (hostId: string) => void;
	readonly broadcastChanged: () => void;
	/** 主机配置变更后丢弃缓存的连接，否则改了端口仍然连着旧机器。 */
	readonly invalidateConnection: (hostId: string) => void;
	/** 是否还有项目指向这台主机。删除前要问，避免把项目留成悬空引用。 */
	readonly countProjectsOnHost: (hostId: string) => Promise<number>;
	readonly generateId: () => string;
}

export class SshHostAlreadyExistsError extends Error {
	constructor(readonly target: string) {
		super(`An SSH host for "${target}" already exists.`);
		this.name = "SshHostAlreadyExistsError";
	}
}

export class SshHostInUseError extends Error {
	constructor(
		readonly hostId: string,
		readonly projectCount: number,
	) {
		super(`SSH host ${hostId} still has ${projectCount} project(s).`);
		this.name = "SshHostInUseError";
	}
}

export type SshHostRebindFailure = "not-orphaned" | "host-in-use";

export class SshHostRebindError extends Error {
	constructor(
		readonly reason: SshHostRebindFailure,
		readonly projectCount = 0,
	) {
		super(
			reason === "host-in-use"
				? `SSH host still has ${projectCount} project(s) of its own.`
				: "No orphaned project refers to that host id.",
		);
		this.name = "SshHostRebindError";
	}
}

function publicHost({ managedIdentityId: _managedIdentityId, ...host }: StoredSshHost): SshHost {
	return host;
}

/**
 * SSH 主机的唯一写入者。
 *
 * 与 ProjectService 同一套理由：主机列表既能从设置页改，也能从 ssh config 导入，
 * 两条路径各自读改写会互相覆盖。
 */
export class SshHostService {
	private mutations: Promise<void> = Promise.resolve();

	private mutate<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.mutations.then(operation);
		this.mutations = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	constructor(private readonly dependencies: SshHostServiceDependencies) {}

	async list(): Promise<SshHost[]> {
		return (await this.dependencies.readHosts()).map(publicHost);
	}

	async get(hostId: string): Promise<SshHost | undefined> {
		return (await this.list()).find((host) => host.id === hostId);
	}

	create(input: SshHostInput, privateKey?: Buffer): Promise<SshHost> {
		return this.mutate(() => this.createSerial(input, privateKey));
	}

	private async createSerial(input: SshHostInput, privateKey?: Buffer): Promise<SshHost> {
		const normalized = normalizeSshHostInput(input);
		const hosts = await this.dependencies.readHosts();
		// 同一个连接目标登记两次没有意义，却会让「这个项目在哪台机器上」出现两个答案。
		if (hosts.some((host) => host.target === normalized.target)) {
			throw new SshHostAlreadyExistsError(normalized.target);
		}
		return this.saveHost(hosts, hosts.length, { id: this.dependencies.generateId(), ...normalized }, privateKey);
	}

	update(hostId: string, input: SshHostInput, privateKey?: Buffer): Promise<SshHost> {
		return this.mutate(() => this.updateSerial(hostId, input, privateKey));
	}

	private async updateSerial(hostId: string, input: SshHostInput, privateKey?: Buffer): Promise<SshHost> {
		const normalized = normalizeSshHostInput(input);
		const hosts = await this.dependencies.readHosts();
		const index = hosts.findIndex((host) => host.id === hostId);
		if (index < 0) throw new Error(`SSH host not found: ${hostId}`);
		if (hosts.some((host) => host.id !== hostId && host.target === normalized.target)) {
			throw new SshHostAlreadyExistsError(normalized.target);
		}
		return this.saveHost(hosts, index, { id: hostId, ...normalized }, privateKey);
	}

	private async saveHost(hosts: StoredSshHost[], index: number, host: SshHost, privateKey?: Buffer): Promise<SshHost> {
		if (privateKey && (host.authMethod === "password" || host.identityFile))
			throw new SshPrivateKeyError("unavailable");
		const previous = hosts[index];
		const imported = privateKey ? await this.dependencies.privateKeys.store(privateKey) : undefined;
		const managedIdentityId = hosts.find(
			(entry) => entry.identityFile === host.identityFile && entry.managedIdentityId,
		)?.managedIdentityId;
		const saved = { ...host, ...(managedIdentityId ? { managedIdentityId } : {}), ...imported };
		hosts[index] = saved;
		try {
			await this.dependencies.writeHosts(hosts);
		} catch (error) {
			if (imported) await this.dependencies.privateKeys.remove(imported.managedIdentityId, imported.identityFile);
			throw error;
		}
		if (previous) {
			if (previous.identityFile !== saved.identityFile) this.dependencies.forgetPassphrase(host.id);
			this.dependencies.invalidateConnection(host.id);
			await this.releaseKey(previous, hosts);
		}
		this.dependencies.broadcastChanged();
		return publicHost(saved);
	}

	private async releaseKey(host: StoredSshHost, remaining: StoredSshHost[]): Promise<void> {
		const { identityFile, managedIdentityId } = host;
		if (identityFile && managedIdentityId && !remaining.some((entry) => entry.identityFile === identityFile)) {
			await this.dependencies.privateKeys.remove(managedIdentityId, identityFile);
		}
	}

	/**
	 * 删除主机。
	 *
	 * 仍被项目引用时拒绝：那些项目会立刻变成永远打不开的悬空条目，而用户在删除
	 * 主机时看不到自己正在同时废掉几个项目。先让调用方去处理项目。
	 */
	remove(hostId: string): Promise<void> {
		return this.mutate(() => this.removeSerial(hostId));
	}

	private async removeSerial(hostId: string): Promise<void> {
		const projectCount = await this.dependencies.countProjectsOnHost(hostId);
		if (projectCount > 0) throw new SshHostInUseError(hostId, projectCount);
		const current = await this.dependencies.readHosts();
		const hosts = current.filter((host) => host.id !== hostId);
		const removed = current.find((host) => host.id === hostId);
		if (!removed) throw new Error(`SSH host not found: ${hostId}`);
		await this.dependencies.writeHosts(hosts);
		this.dependencies.forgetPassphrase(hostId);
		this.dependencies.invalidateConnection(hostId);
		await this.releaseKey(removed, hosts);
		this.dependencies.broadcastChanged();
	}

	/**
	 * 让一台已登记的主机顶替孤儿项目指向的旧 id。
	 *
	 * 主机被删掉再重加会拿到新 id，而项目路径、会话 cwd 与会话目录名里写死的都是旧 id。
	 * 改主机这一侧的 id，那些引用原样就能接上；反过来改项目那一侧，要迁一整片会话文件。
	 *
	 * 两条护栏：旧 id 必须真有项目在用、且不属于任何登记着的主机（否则只是一串随手填的
	 * 字符，或会造出两条同 id 主机）；这台主机自己不能已经有项目（否则那些项目变成新孤儿）。
	 */
	rebind(hostId: string, orphanId: string): Promise<SshHost> {
		return this.mutate(() => this.rebindSerial(hostId, orphanId));
	}

	private async rebindSerial(hostId: string, orphanId: string): Promise<SshHost> {
		const hosts = await this.dependencies.readHosts();
		const index = hosts.findIndex((host) => host.id === hostId);
		if (index < 0) throw new Error(`SSH host not found: ${hostId}`);
		const orphaned =
			!hosts.some((host) => host.id === orphanId) && (await this.dependencies.countProjectsOnHost(orphanId)) > 0;
		if (!orphaned) throw new SshHostRebindError("not-orphaned");
		const ownProjects = await this.dependencies.countProjectsOnHost(hostId);
		if (ownProjects > 0) throw new SshHostRebindError("host-in-use", ownProjects);
		const rebound: StoredSshHost = { ...hosts[index], id: orphanId };
		hosts[index] = rebound;
		await this.commit(hosts);
		// 旧 id 上可能缓存着一次「主机不存在」的连接尝试，新 id 上的连接也不再对应任何主机。
		this.dependencies.invalidateConnection(hostId);
		this.dependencies.invalidateConnection(orphanId);
		return publicHost(rebound);
	}

	/**
	 * 从 `~/.ssh/config` 导入别名。
	 *
	 * 只新增，不覆盖：`manual` 的条目是用户手工调过的，被导入改回去等于悄悄丢掉
	 * 他的修改；已存在的 `ssh-config` 条目也保持原样，因为别名背后的参数由 OpenSSH
	 * 在连接时解析，Vetta 这边不需要缓存一份必然漂移的副本。
	 */
	importFromSshConfig(aliases: readonly string[]): Promise<SshHost[]> {
		return this.mutate(() => this.importFromSshConfigSerial(aliases));
	}

	private async importFromSshConfigSerial(aliases: readonly string[]): Promise<SshHost[]> {
		const hosts = await this.dependencies.readHosts();
		const existing = new Set(hosts.map((host) => host.target));
		const added: SshHost[] = [];
		for (const alias of aliases) {
			if (existing.has(alias)) continue;
			const normalized = normalizeSshHostInput({ label: alias, target: alias, source: "ssh-config" });
			const host: SshHost = { id: this.dependencies.generateId(), ...normalized };
			hosts.push(host);
			added.push(host);
			existing.add(alias);
		}
		if (added.length > 0) await this.commit(hosts);
		return added;
	}

	private async commit(hosts: StoredSshHost[]): Promise<void> {
		await this.dependencies.writeHosts(hosts);
		this.dependencies.broadcastChanged();
	}
}
