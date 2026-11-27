import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, unlink } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { SshPrivateKeySelection } from "../../shared/ssh-ipc.js";
import { normalizeSshPrivateKey } from "./ssh-private-key-format.js";

const MAX_KEY_BYTES = 64 * 1024;
const MANAGED_KEY_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const setWindowsKeyDirectoryAcl = `
$ErrorActionPreference = 'Stop'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetSecurityDescriptorSddlForm("D:P(A;OICI;FA;;;$($user.Value))", [System.Security.AccessControl.AccessControlSections]::Access)
$acl.SetOwner($user)
[System.IO.Directory]::SetAccessControl($env:AGENT567_SSH_KEY_DIRECTORY, $acl)
`;

export class SshPrivateKeyError extends Error {
	constructor(
		readonly reason: "unreadable" | "tooLarge" | "invalid" | "unavailable" | "storeFailed",
		options?: ErrorOptions,
	) {
		super(`SSH private key: ${reason}`, options);
	}
}

async function readSelectedKey(path: string): Promise<Buffer> {
	const bytes = Buffer.alloc(MAX_KEY_BYTES + 1);
	try {
		if (!(await lstat(path)).isFile()) throw new SshPrivateKeyError("unreadable");
		const flags =
			constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const file = await open(path, flags);
		let size = 0;
		try {
			const stat = await file.stat();
			if (!stat.isFile()) throw new SshPrivateKeyError("unreadable");
			if (stat.size > MAX_KEY_BYTES) throw new SshPrivateKeyError("tooLarge");
			while (size < bytes.length) {
				const { bytesRead } = await file.read(bytes, size, bytes.length - size, size);
				if (bytesRead === 0) break;
				size += bytesRead;
			}
		} finally {
			await file.close();
		}
		if (size > MAX_KEY_BYTES) throw new SshPrivateKeyError("tooLarge");
		const key = bytes.subarray(0, size);
		const normalized = normalizeSshPrivateKey(key);
		if (!normalized) throw new SshPrivateKeyError("invalid");
		if (normalized !== key) bytes.fill(0);
		return normalized;
	} catch (error) {
		bytes.fill(0);
		throw error instanceof SshPrivateKeyError ? error : new SshPrivateKeyError("unreadable");
	}
}

export class SshPrivateKeyPicker {
	private staged?: { ref: string; bytes: Buffer; saving: boolean };
	private generation = 0;
	private picking = false;

	async pick(select: () => Promise<string | undefined>): Promise<SshPrivateKeySelection | null> {
		if (this.picking) return null;
		this.picking = true;
		const generation = this.generation;
		try {
			const path = await select();
			if (!path || generation !== this.generation) return null;
			const bytes = await readSelectedKey(path);
			if (generation !== this.generation) {
				bytes.fill(0);
				return null;
			}
			const ref = randomUUID();
			this.discard();
			this.staged = { ref, bytes, saving: false };
			return { ref, name: basename(path) };
		} catch (error) {
			throw error instanceof SshPrivateKeyError ? error : new SshPrivateKeyError("unreadable");
		} finally {
			this.picking = false;
		}
	}

	discard(ref?: string): void {
		if (ref === undefined) this.generation++;
		if (!this.staged || (ref !== undefined && ref !== this.staged.ref)) return;
		this.staged.bytes.fill(0);
		this.staged = undefined;
	}

	async save<T>(ref: string, persist: (bytes: Buffer) => Promise<T>): Promise<T> {
		const staged = this.staged;
		if (!staged || staged.ref !== ref || staged.saving) throw new SshPrivateKeyError("unavailable");
		staged.saving = true;
		const bytes = Buffer.from(staged.bytes);
		try {
			const result = await persist(bytes);
			this.discard(ref);
			return result;
		} finally {
			staged.saving = false;
			bytes.fill(0);
		}
	}
}

async function restrictDirectory(path: string): Promise<void> {
	if (process.platform !== "win32") {
		await chmod(path, 0o700);
		return;
	}
	const systemRoot = process.env.SystemRoot;
	if (!systemRoot) throw new SshPrivateKeyError("storeFailed");
	await promisify(execFile)(
		join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			Buffer.from(setWindowsKeyDirectoryAcl, "utf16le").toString("base64"),
		],
		{
			env: { ...process.env, AGENT567_SSH_KEY_DIRECTORY: path },
			windowsHide: true,
			timeout: 10_000,
		},
	);
}

export class SshPrivateKeyStore {
	private readonly directory: string;

	constructor(home: string) {
		this.directory = resolve(home, "ssh-private-keys");
	}

	private filePath(id: string): string {
		return join(this.directory, `${id}.key`);
	}

	async store(bytes: Buffer): Promise<{ identityFile: string; managedIdentityId: string }> {
		const id = randomUUID();
		const path = this.filePath(id);
		try {
			await mkdir(this.directory, { recursive: true, mode: 0o700 });
			const directoryInfo = await lstat(this.directory);
			if (!directoryInfo.isDirectory() || (process.getuid && directoryInfo.uid !== process.getuid())) {
				throw new SshPrivateKeyError("storeFailed");
			}
			await restrictDirectory(this.directory);
			const file = await open(path, "wx", 0o600);
			try {
				try {
					if (process.platform !== "win32") await file.chmod(0o600);
					await file.writeFile(bytes);
					await file.sync();
				} finally {
					await file.close();
				}
			} catch (error) {
				await this.remove(id, path);
				throw error;
			}
			return { identityFile: path, managedIdentityId: id };
		} catch (cause) {
			throw new SshPrivateKeyError("storeFailed", { cause });
		}
	}

	async remove(id: string, path: string): Promise<void> {
		if (!MANAGED_KEY_ID.test(id) || path !== this.filePath(id)) return;
		try {
			if ((await lstat(this.directory)).isDirectory() && (await lstat(path)).isFile()) await unlink(path);
		} catch {
			return;
		}
	}
}
