import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { atomicWriteJSONAsync } from "@567agent/toolkit/atomic-write";
import { createVersionedJsonConfigStore } from "@567agent/toolkit/config-store";
import { migrateVersionedConfig } from "@567agent/toolkit/versioned-config";
import type { ProjectCollaborationDocument } from "../../shared/project-collaboration.js";
import { MAX_COLLABORATION_BYTES } from "./limits.js";
import { validateDocument } from "./validation.js";

export interface ProjectCollaborationStore {
	read(): Promise<ProjectCollaborationDocument>;
	update(
		mutator: (
			document: ProjectCollaborationDocument,
		) => ProjectCollaborationDocument | Promise<ProjectCollaborationDocument>,
	): Promise<ProjectCollaborationDocument>;
}

const updateTails = new Map<string, Promise<void>>();

export function createDefaultProjectCollaborationDocument(): ProjectCollaborationDocument {
	return {
		schemaVersion: 1,
		config: {
			schemaVersion: 1,
			revision: 0,
			enabled: false,
			paused: false,
			coordinatorSessionId: null,
			members: [],
		},
		tasks: [],
	};
}

function normalizedCwd(cwd: string): string {
	const absolutePath = normalize(resolve(cwd)).normalize("NFC");
	return process.platform === "win32" ? absolutePath.toLocaleLowerCase("en-US") : absolutePath;
}

function createDocumentStore(path: string) {
	return createVersionedJsonConfigStore<ProjectCollaborationDocument>({
		path,
		name: "project-collaboration",
		readErrorPolicy: "throw",
		writeJson: atomicWriteJSONAsync,
		migrate(value) {
			if (
				typeof value !== "object" ||
				value === null ||
				Array.isArray(value) ||
				!Number.isSafeInteger((value as Record<string, unknown>).schemaVersion) ||
				Number((value as Record<string, unknown>).schemaVersion) < 1
			) {
				throw new Error("Invalid project collaboration schemaVersion");
			}
			const result = migrateVersionedConfig(value, { currentVersion: 1, migrations: [] });
			return { ...result, config: validateDocument(result.config) as unknown as Record<string, unknown> };
		},
		normalize(value) {
			return value === undefined ? createDefaultProjectCollaborationDocument() : validateDocument(value);
		},
	});
}

export function createCollaborationStore(cwd: string): ProjectCollaborationStore {
	const key = normalizedCwd(cwd);
	const projectHash = createHash("sha256").update(key).digest("hex");
	const path = join(getAgent567HomePath(), "desktop-app", "project-collaboration", `${projectHash}.json`);
	const store = createDocumentStore(path);
	const read = async () => {
		try {
			const file = await stat(path);
			if (file.size > MAX_COLLABORATION_BYTES)
				throw new Error("Project collaboration data exceeds the 32 MB limit; restore a smaller backup");
		} catch (error) {
			if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
		}
		return store.read();
	};

	return {
		read,
		update(mutator) {
			const previous = updateTails.get(path) ?? Promise.resolve();
			const operation = previous.then(async () => {
				const current = await read();
				const candidate = validateDocument(await mutator(structuredClone(current)));
				const configChanged =
					candidate.config.enabled !== current.config.enabled ||
					candidate.config.paused !== current.config.paused ||
					candidate.config.coordinatorSessionId !== current.config.coordinatorSessionId ||
					JSON.stringify(candidate.config.members) !== JSON.stringify(current.config.members);
				const nextRevision = configChanged ? current.config.revision + 1 : current.config.revision;
				if (!Number.isSafeInteger(nextRevision)) throw new Error("Project collaboration revision exhausted");
				const next = validateDocument({
					...candidate,
					config: { ...candidate.config, revision: nextRevision },
				});
				if (Buffer.byteLength(JSON.stringify(next)) > MAX_COLLABORATION_BYTES)
					throw new Error("Project collaboration data exceeds the 32 MB storage limit");
				await store.write(next);
				return structuredClone(next);
			});
			const tail = operation.then(
				() => undefined,
				() => undefined,
			);
			updateTails.set(path, tail);
			void tail.then(() => {
				if (updateTails.get(path) === tail) updateTails.delete(path);
			});
			return operation;
		},
	};
}
