import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopConfig } from "../config/desktop-config-store.js";
import {
	SshHostAlreadyExistsError,
	SshHostInUseError,
	SshHostRebindError,
	SshHostService,
} from "./ssh-host-service.js";
import { createSshHostStore } from "./ssh-host-store.js";
import { SshPrivateKeyPicker, SshPrivateKeyStore } from "./ssh-private-key.js";

function createFixture(initial?: Partial<DesktopConfig>) {
	let config: DesktopConfig = {
		projects: [],
		archivedProjects: [],
		workspacePath: "/workspace",
		defaultExecutionMode: "full-access",
		...initial,
	};
	const broadcastChanged = vi.fn();
	const invalidateConnection = vi.fn();
	let nextId = 0;
	const service = new SshHostService({
		privateKeys: new SshPrivateKeyStore(tmpdir()),
		forgetPassphrase: vi.fn(),
		readHosts: async () => structuredClone(config.sshHosts ?? []),
		writeHosts: async (hosts) => {
			config = { ...config, sshHosts: structuredClone(hosts) };
		},
		broadcastChanged,
		invalidateConnection,
		countProjectsOnHost: async (hostId) =>
			[...config.projects, ...config.archivedProjects].filter((entry) => entry.path.startsWith(`ssh://${hostId}/`))
				.length,
		generateId: () => `host-${++nextId}`,
	});
	return { broadcastChanged, invalidateConnection, getConfig: () => config, service };
}

describe("SshHostService", () => {
	it("创建主机并生成稳定 id，凭据不落配置", async () => {
		const fixture = createFixture();

		const host = await fixture.service.create({ label: "构建机", target: "build-01" });

		expect(host).toEqual({ id: "host-1", label: "构建机", target: "build-01", source: "manual" });
		expect(fixture.getConfig().sshHosts).toEqual([host]);
		expect(fixture.broadcastChanged).toHaveBeenCalledTimes(1);
	});

	it("同一个连接目标不能登记两次", async () => {
		// 否则「这个项目在哪台机器上」会出现两个都说得通的答案。
		const fixture = createFixture();
		await fixture.service.create({ label: "A", target: "build-01" });

		await expect(fixture.service.create({ label: "B", target: "build-01" })).rejects.toBeInstanceOf(
			SshHostAlreadyExistsError,
		);
		expect(fixture.getConfig().sshHosts).toHaveLength(1);
	});

	it("拒绝会被 OpenSSH 当成选项解析的目标", async () => {
		const fixture = createFixture();

		await expect(fixture.service.create({ label: "x", target: "-oProxyCommand=id" })).rejects.toThrow(
			"must not start with '-'",
		);
	});

	it("改完主机要作废缓存连接，否则改了端口仍连着旧机器", async () => {
		const fixture = createFixture();
		const host = await fixture.service.create({ label: "构建机", target: "build-01" });

		await fixture.service.update(host.id, { label: "构建机", target: "build-01", port: 2222 });

		expect(fixture.getConfig().sshHosts?.[0]).toMatchObject({ port: 2222 });
		expect(fixture.invalidateConnection).toHaveBeenCalledWith(host.id);
	});

	it("仍被项目引用的主机不能删除", async () => {
		// 删掉的话那些项目会变成永远打不开的悬空条目，而用户在删主机时看不到这一点。
		const fixture = createFixture();
		const host = await fixture.service.create({ label: "构建机", target: "build-01" });
		fixture.getConfig().projects.push({ path: `ssh://${host.id}/srv/app`, name: "app" });

		const error = await fixture.service.remove(host.id).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SshHostInUseError);
		expect((error as SshHostInUseError).projectCount).toBe(1);
		expect(fixture.getConfig().sshHosts).toHaveLength(1);
	});

	it("没有项目引用时正常删除并作废连接", async () => {
		const fixture = createFixture();
		const host = await fixture.service.create({ label: "构建机", target: "build-01" });

		await fixture.service.remove(host.id);

		expect(fixture.getConfig().sshHosts).toEqual([]);
		expect(fixture.invalidateConnection).toHaveBeenCalledWith(host.id);
	});
});

describe("managed SSH private keys", () => {
	let directory: string;
	const input = { label: "Build host", target: "build-01" };
	const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
	const pem = Buffer.from(keys.privateKey.export({ type: "sec1", format: "pem" }));
	const encryptedPem = Buffer.from(
		keys.privateKey.export({
			type: "pkcs8",
			format: "pem",
			cipher: "aes-256-cbc",
			passphrase: "fixture only",
		}),
	);

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "agent567-ssh-"));
	});
	afterEach(async () => {
		await rm(directory, { force: true, recursive: true });
	});

	function managedFixture() {
		const home = join(directory, "app-home");
		const configPath = join(home, "ssh-hosts.json");
		const store = createSshHostStore(configPath);
		const writeHosts = vi.fn(store.write);
		const forgetPassphrase = vi.fn();
		const service = new SshHostService({
			readHosts: store.read,
			writeHosts,
			privateKeys: new SshPrivateKeyStore(home),
			broadcastChanged: vi.fn(),
			invalidateConnection: vi.fn(),
			forgetPassphrase,
			countProjectsOnHost: async () => 0,
			generateId: () => `host-${writeHosts.mock.calls.length}`,
		});
		return { service, picker: new SshPrivateKeyPicker(), home, configPath, store, writeHosts, forgetPassphrase };
	}

	it.skipIf(process.platform !== "win32")(
		"protects the managed directory and grants key access only to the current user",
		async () => {
			const key = await new SshPrivateKeyStore(directory).store(pem);
			const script = `
$ErrorActionPreference = 'Stop'
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$key = $env:AGENT567_TEST_SSH_KEY_FILE
$directory = [System.IO.Directory]::GetAccessControl([System.IO.Path]::GetDirectoryName($key))
if (!$directory.AreAccessRulesProtected -or $directory.GetOwner($sid.GetType()).Value -ne $sid.Value) {
    throw 'The managed directory must block inherited permissions and be owned by the current user.'
}
foreach ($acl in @($directory, [System.IO.File]::GetAccessControl($key))) {
    $rules = @($acl.GetAccessRules($true, $true, $sid.GetType()))
    if ($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $sid.Value -or $rules[0].AccessControlType -ne 'Allow') {
        throw 'The managed key and its directory must grant access only to the current user.'
    }
}
`;
			execFileSync(
				join(process.env.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
				[
					"-NoLogo",
					"-NoProfile",
					"-NonInteractive",
					"-EncodedCommand",
					Buffer.from(script, "utf16le").toString("base64"),
				],
				{
					env: { ...process.env, AGENT567_TEST_SSH_KEY_FILE: key.identityFile },
					windowsHide: true,
					timeout: 10_000,
				},
			);
		},
		15_000,
	);

	it("stages a selected file in memory, persists a private copy on save and replaces it only after the host is written", async () => {
		const { service, picker, home, configPath, store, writeHosts, forgetPassphrase } = managedFixture();
		const source = join(directory, "my-key");
		await writeFile(source, pem);
		const firstSelection = (await picker.pick(async () => source))!;
		expect(firstSelection).toEqual({ ref: expect.any(String), name: "my-key" });
		await expect(stat(home)).rejects.toMatchObject({ code: "ENOENT" });
		await writeFile(source, encryptedPem);

		const host = await picker.save(firstSelection.ref, (bytes) => service.create(input, bytes));
		const originalCopy = host.identityFile!;
		expect(dirname(originalCopy)).toBe(join(home, "ssh-private-keys"));
		expect((await readFile(originalCopy)).equals(pem)).toBe(true);
		if (process.platform !== "win32") {
			expect((await stat(dirname(originalCopy))).mode & 0o777).toBe(0o700);
			expect((await stat(originalCopy)).mode & 0o777).toBe(0o600);
		}
		expect(await service.list()).toEqual([host]);
		expect(await readFile(configPath, "utf8")).not.toMatch(/PRIVATE KEY|my-key/);
		await expect(picker.save(firstSelection.ref, async () => undefined)).rejects.toMatchObject({
			reason: "unavailable",
		});

		const secondSelection = (await picker.pick(async () => source))!;
		writeHosts.mockRejectedValueOnce(new Error("Host config write failed"));
		const replaceKey = () => picker.save(secondSelection.ref, (bytes) => service.update(host.id, input, bytes));
		await expect(replaceKey()).rejects.toThrow("Host config write failed");
		expect(await readdir(dirname(originalCopy))).toHaveLength(1);
		expect(await service.get(host.id)).toEqual(host);
		expect(forgetPassphrase).not.toHaveBeenCalled();

		const updated = await replaceKey();
		const replacement = updated.identityFile!;
		expect(replacement).not.toBe(originalCopy);
		expect((await readFile(replacement)).equals(encryptedPem)).toBe(true);
		expect(store.readSync()[0]?.identityFile).toBe(replacement);
		await expect(stat(originalCopy)).rejects.toMatchObject({ code: "ENOENT" });
		expect(forgetPassphrase).toHaveBeenCalledWith(host.id);

		await service.update(host.id, { ...input, authMethod: "password" });
		const passwordHost = await service.get(host.id);
		expect(passwordHost?.authMethod).toBe("password");
		expect(passwordHost?.identityFile).toBeUndefined();
		await expect(stat(replacement)).rejects.toMatchObject({ code: "ENOENT" });
		expect((await readFile(source)).equals(encryptedPem)).toBe(true);
	});

	it("discards a canceled selection and preserves manually referenced originals and still-shared managed copies", async () => {
		const { service, picker, home } = managedFixture();
		const source = join(directory, "original");
		await writeFile(source, pem);
		const selection = (await picker.pick(async () => source))!;
		picker.discard(selection.ref);
		await expect(picker.save(selection.ref, (bytes) => service.create(input, bytes))).rejects.toMatchObject({
			reason: "unavailable",
		});
		await expect(stat(home)).rejects.toMatchObject({ code: "ENOENT" });

		const manual = await service.create({ ...input, identityFile: source });
		const imported = (await picker.pick(async () => source))!;
		const first = await picker.save(imported.ref, (bytes) => service.update(manual.id, input, bytes));
		const second = await service.create({
			label: "Other host",
			target: "build-02",
			identityFile: first.identityFile,
		});
		await service.remove(first.id);
		expect((await readFile(second.identityFile!)).equals(pem)).toBe(true);
		await service.remove(second.id);
		await expect(stat(second.identityFile!)).rejects.toMatchObject({ code: "ENOENT" });
		expect((await readFile(source)).equals(pem)).toBe(true);
	});

	it("preserves the last valid selection across canceled and rejected replacements", async () => {
		const { service, picker, home } = managedFixture();
		const source = join(directory, "key");
		await writeFile(source, pem);
		const selected = (await picker.pick(async () => source))!;
		expect(await picker.pick(async () => undefined)).toBeNull();

		const badFiles = [
			["public.pem", keys.publicKey.export({ type: "spki", format: "pem" }), "invalid"],
			[
				"fake-openssh",
				["-----BEGIN", "OPENSSH PRIVATE KEY-----\nZW1wdHk=\n-----END OPENSSH PRIVATE KEY-----\n"].join(" "),
				"invalid",
			],
			["oversized", Buffer.alloc(64 * 1024 + 1), "tooLarge"],
		] as const;
		for (const [name, body, reason] of badFiles) {
			const path = join(directory, name);
			await writeFile(path, body);
			await expect(picker.pick(async () => path)).rejects.toMatchObject({ reason });
		}
		await expect(picker.pick(async () => directory)).rejects.toMatchObject({ reason: "unreadable" });
		await expect(stat(home)).rejects.toMatchObject({ code: "ENOENT" });
		const host = await picker.save(selected.ref, (bytes) => service.create(input, bytes));
		expect((await readFile(host.identityFile!)).equals(pem)).toBe(true);
	});

	it.skipIf(spawnSync("ssh-keygen", ["-?"], { stdio: "ignore" }).error !== undefined)(
		"imports real plain and passphrase-encrypted OpenSSH keys without a passphrase",
		async () => {
			const { picker, service } = managedFixture();
			for (const [format, passphrase] of [
				["ed25519", ""],
				["rsa", "fixture only"],
			]) {
				const source = join(directory, format);
				execFileSync("ssh-keygen", ["-q", "-t", format, "-N", passphrase, "-f", source], { stdio: "ignore" });
				const original = await readFile(source);
				if (passphrase) await writeFile(source, original.toString("utf8").trimEnd().replaceAll("\n", "\r\n"));
				const selected = (await picker.pick(async () => source))!;
				const host = await picker.save(selected.ref, (bytes) =>
					service.create({ label: format, target: format }, bytes),
				);
				expect((await readFile(host.identityFile!)).equals(original)).toBe(true);
			}
		},
	);
});

describe("从 ssh config 导入", () => {
	it("只新增，不覆盖用户手工调过的同名条目", async () => {
		const fixture = createFixture();
		await fixture.service.create({ label: "我改过的", target: "build-01", port: 2222 });

		const added = await fixture.service.importFromSshConfig(["build-01", "lab"]);

		expect(added.map((host) => host.target)).toEqual(["lab"]);
		expect(fixture.getConfig().sshHosts?.[0]).toMatchObject({ label: "我改过的", port: 2222 });
	});

	it("导入的条目标记来源，便于后续区分是否可被再次导入刷新", async () => {
		const fixture = createFixture();

		const [host] = await fixture.service.importFromSshConfig(["lab"]);

		expect(host).toMatchObject({ target: "lab", label: "lab", source: "ssh-config" });
	});

	it("没有新增时不落盘也不广播", async () => {
		const fixture = createFixture();
		await fixture.service.importFromSshConfig(["lab"]);
		fixture.broadcastChanged.mockClear();

		await fixture.service.importFromSshConfig(["lab"]);

		expect(fixture.broadcastChanged).not.toHaveBeenCalled();
	});
});

describe("把孤儿项目重新绑到一台主机上", () => {
	// 删掉再重加主机会拿到新 id，而项目路径与会话 cwd 里写死的是旧 id。改主机 id 而不是改
	// 项目：会话目录、会话头里的 cwd 全都按旧 id 存着，改项目那一侧要迁一整片会话文件。
	const orphanId = "lost-host";

	function withOrphanProject() {
		const fixture = createFixture();
		fixture.getConfig().projects.push({ path: `ssh://${orphanId}/srv/app`, name: "app" });
		return fixture;
	}

	it("主机换上孤儿项目的旧 id，其余字段不变，并作废两边的连接", async () => {
		const fixture = withOrphanProject();
		const host = await fixture.service.create({ label: "构建机", target: "build-01", port: 2222 });
		fixture.broadcastChanged.mockClear();

		const rebound = await fixture.service.rebind(host.id, orphanId);

		expect(rebound).toEqual({ ...host, id: orphanId });
		expect(fixture.getConfig().sshHosts).toEqual([rebound]);
		expect(fixture.invalidateConnection).toHaveBeenCalledWith(host.id);
		expect(fixture.invalidateConnection).toHaveBeenCalledWith(orphanId);
		expect(fixture.broadcastChanged).toHaveBeenCalledTimes(1);
	});

	it("没有项目在用的 id 不接受——那只是随手填的一串字符", async () => {
		const fixture = createFixture();
		const host = await fixture.service.create({ label: "构建机", target: "build-01" });

		await expect(fixture.service.rebind(host.id, "whatever")).rejects.toMatchObject({
			name: "SshHostRebindError",
			reason: "not-orphaned",
		});
		expect(fixture.getConfig().sshHosts?.[0]?.id).toBe(host.id);
	});

	it("旧 id 仍属于一台登记着的主机时拒绝，否则会出现两条同 id 主机", async () => {
		const fixture = withOrphanProject();
		const a = await fixture.service.create({ label: "A", target: "build-01" });
		fixture.getConfig().sshHosts?.push({ id: orphanId, label: "B", target: "build-02", source: "manual" });

		await expect(fixture.service.rebind(a.id, orphanId)).rejects.toMatchObject({ reason: "not-orphaned" });
	});

	it("这台主机自己已经有项目时拒绝，否则那些项目会变成新的孤儿", async () => {
		const fixture = withOrphanProject();
		const host = await fixture.service.create({ label: "构建机", target: "build-01" });
		fixture.getConfig().projects.push({ path: `ssh://${host.id}/srv/other`, name: "other" });

		const error = await fixture.service.rebind(host.id, orphanId).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(SshHostRebindError);
		expect(error).toMatchObject({ reason: "host-in-use", projectCount: 1 });
		expect(fixture.getConfig().sshHosts?.[0]?.id).toBe(host.id);
	});

	it("主机不存在时报错", async () => {
		const fixture = withOrphanProject();

		await expect(fixture.service.rebind("nope", orphanId)).rejects.toThrow("SSH host not found");
	});
});
