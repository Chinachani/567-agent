import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { normalizeSshHostInput, type SshHost } from "@567agent/ssh-transport";
import { atomicWriteJSON } from "@567agent/toolkit/atomic-write";
import { createVersionedJsonConfigStore } from "@567agent/toolkit/config-store";

export interface StoredSshHost extends SshHost {
	readonly managedIdentityId?: string;
}

interface SshHostDocument {
	readonly schemaVersion: 1;
	readonly hosts: StoredSshHost[];
}

function normalizeHostDocument(value: unknown): SshHostDocument {
	if (value === undefined) return { schemaVersion: 1, hosts: [] };
	if (typeof value !== "object" || value === null) throw new Error("Invalid SSH host configuration");
	const document = value as Record<string, unknown>;
	if (document.schemaVersion !== 1 || !Array.isArray(document.hosts))
		throw new Error("Unsupported SSH host configuration");
	const ids = new Set<string>();
	const hosts = document.hosts.map((entry: unknown): StoredSshHost => {
		if (typeof entry !== "object" || entry === null) throw new Error("Invalid SSH host entry");
		const raw = entry as Record<string, unknown>;
		if (typeof raw.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(raw.id) || ids.has(raw.id))
			throw new Error("Invalid or duplicate SSH host id");
		if (typeof raw.label !== "string" || typeof raw.target !== "string") throw new Error("Invalid SSH host target");
		if (
			(raw.port !== undefined && typeof raw.port !== "number") ||
			(raw.identityFile !== undefined && typeof raw.identityFile !== "string") ||
			(raw.credentialRef !== undefined && typeof raw.credentialRef !== "string") ||
			(raw.authMethod !== undefined && raw.authMethod !== "key" && raw.authMethod !== "password") ||
			(raw.source !== undefined && raw.source !== "manual" && raw.source !== "ssh-config")
		)
			throw new Error("Invalid SSH host options");
		ids.add(raw.id);
		return {
			id: raw.id,
			...normalizeSshHostInput({
				label: raw.label,
				target: raw.target,
				port: typeof raw.port === "number" ? raw.port : undefined,
				identityFile: typeof raw.identityFile === "string" ? raw.identityFile : undefined,
				authMethod: raw.authMethod === "password" ? "password" : "key",
				source: raw.source === "ssh-config" ? "ssh-config" : "manual",
				credentialRef: typeof raw.credentialRef === "string" ? raw.credentialRef : undefined,
			}),
			...(typeof raw.managedIdentityId === "string" ? { managedIdentityId: raw.managedIdentityId } : {}),
		};
	});
	return { schemaVersion: 1, hosts };
}

/** Kept outside desktop-config: older installed versions rewrite that file. */
export function createSshHostStore(path = join(getAgent567HomePath(), "ssh-hosts.json")) {
	const store = createVersionedJsonConfigStore({
		path,
		name: "ssh-hosts",
		normalize: normalizeHostDocument,
		readErrorPolicy: "throw",
	});
	return {
		read: async () => (await store.read()).hosts,
		readSync: (legacy?: unknown) => {
			if (!existsSync(path) && Array.isArray(legacy)) {
				atomicWriteJSON(path, normalizeHostDocument({ schemaVersion: 1, hosts: legacy }));
			}
			return store.readSync().hosts;
		},
		write: (hosts: readonly StoredSshHost[]) => store.write({ schemaVersion: 1, hosts: [...hosts] }),
	};
}

export const sshHostStore = createSshHostStore();
