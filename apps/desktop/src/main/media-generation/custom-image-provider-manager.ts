import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { atomicWriteJSON } from "@567agent/toolkit/atomic-write";
import type { Disposable } from "@vetta-org/capability-sdk";
import lockfile from "proper-lockfile";
import {
	CUSTOM_IMAGE_PROVIDER_LIMIT,
	type CustomImageProviderInput,
	type CustomImageProviderSummary,
} from "../../shared/custom-image-providers.js";
import type { CredentialRef, CredentialVault } from "../credentials/credential-vault.js";
import { getDesktopCredentialVault } from "../credentials/desktop-credential-vault.js";
import { getAppLogger } from "../logger.js";
import {
	CustomImageProviderError,
	parseCustomImageProviderInput,
	parseStoredImageProviders,
	type StoredImageProvider,
} from "./custom-image-provider-config.js";
import type { MediaArtifactStore } from "./media-artifact-store.js";
import type { MediaProviderRegistry } from "./media-provider-registry.js";
import { type CustomImageFetch, createOpenAiCompatibleImageProvider } from "./openai-compatible-image-provider.js";

export { CustomImageProviderError } from "./custom-image-provider-config.js";

interface ManagerOptions {
	storePath?: string;
	vault?: CredentialVault;
	fetch: CustomImageFetch;
}

const log = getAppLogger("custom-image-providers");
function credentialRef(entry: StoredImageProvider): CredentialRef {
	return { namespace: "image-providers", ownerId: entry.id, name: entry.credentialName };
}

/** Metadata commits select immutable, encrypted credential revisions. A failed save never replaces the active key. */
export class CustomImageProviderManager {
	private readonly storePath: string;
	private readonly vault: CredentialVault;
	private readonly registrations = new Map<string, { entry: StoredImageProvider; registration: Disposable }>();
	private entries: StoredImageProvider[] = [];

	constructor(
		private readonly registry: MediaProviderRegistry,
		private readonly artifacts: MediaArtifactStore,
		private readonly options: ManagerOptions,
	) {
		this.storePath = options.storePath ?? join(getAgent567HomePath(), "desktop-app", "custom-image-providers.json");
		this.vault = options.vault ?? getDesktopCredentialVault();
		try {
			this.refresh();
		} catch {
			log.warn("Image service store could not be loaded", {});
		}
	}

	list(): CustomImageProviderSummary[] {
		this.refresh();
		return this.entries.map((entry) => this.summary(entry));
	}

	save(raw: CustomImageProviderInput): CustomImageProviderSummary {
		const input = parseCustomImageProviderInput(raw);
		return this.withStoreLock(() => {
			this.refresh();
			const existing = input.id ? this.entries.find((entry) => entry.id === input.id) : undefined;
			if (input.id && !existing) throw new CustomImageProviderError("not-found", "Image service was not found");
			if (!existing && this.entries.length >= CUSTOM_IMAGE_PROVIDER_LIMIT)
				throw new CustomImageProviderError("too-many", "Image service limit reached");
			const originChanged = existing && new URL(existing.baseUrl).origin !== new URL(input.baseUrl).origin;
			if (!input.apiKey && (!existing || originChanged || !this.vault.has(credentialRef(existing))))
				throw new CustomImageProviderError("api-key-required", "API key is required");
			if (input.apiKey && !this.vault.isAvailable())
				throw new CustomImageProviderError("secret-storage-unavailable", "Secure credential storage unavailable");
			const { apiKey, ...fields } = input;
			const entry: StoredImageProvider = {
				...fields,
				id: existing?.id ?? randomUUID(),
				credentialName: apiKey ? `api-key-${randomUUID()}` : existing!.credentialName,
			};
			const next = existing
				? this.entries.map((item) => (item.id === entry.id ? entry : item))
				: [...this.entries, entry];
			if (apiKey) {
				try {
					this.vault.put(credentialRef(entry), apiKey, { kind: "api-key", consumer: "custom-image-provider" });
				} catch {
					throw new CustomImageProviderError("secret-storage-unavailable", "Credential could not be saved");
				}
			}
			try {
				this.writeStore(next);
			} catch (error) {
				if (apiKey) this.cleanupCredential(entry);
				throw error;
			}
			this.activate(next);
			if (apiKey && existing) this.cleanupCredential(existing);
			return this.summary(entry);
		});
	}

	remove(id: string): void {
		this.withStoreLock(() => {
			this.refresh();
			const existing = this.entries.find((entry) => entry.id === id);
			if (!existing) return;
			const next = this.entries.filter((entry) => entry.id !== id);
			this.writeStore(next);
			this.activate(next);
			this.cleanupCredential(existing);
		});
	}

	dispose(): void {
		for (const { registration } of this.registrations.values()) registration.dispose();
		this.registrations.clear();
	}

	private summary({ credentialName: _credentialName, ...entry }: StoredImageProvider): CustomImageProviderSummary {
		return {
			...entry,
			hasApiKey: this.vault.has({ namespace: "image-providers", ownerId: entry.id, name: _credentialName }),
		};
	}

	private refresh(): void {
		try {
			const next = existsSync(this.storePath)
				? parseStoredImageProviders(JSON.parse(readFileSync(this.storePath, "utf8")))
				: [];
			this.activate(next);
		} catch {
			throw new CustomImageProviderError("store-unavailable", "Image service store unavailable");
		}
	}

	private activate(next: StoredImageProvider[]): void {
		for (const [id, current] of this.registrations) {
			if (next.some((entry) => entry.id === id && JSON.stringify(entry) === JSON.stringify(current.entry))) continue;
			current.registration.dispose();
			this.registrations.delete(id);
		}
		for (const entry of next) {
			if (this.registrations.has(entry.id)) continue;
			const registration = this.registry.registerProvider(
				createOpenAiCompatibleImageProvider(
					this.artifacts,
					entry,
					() => {
						try {
							return this.vault.get(credentialRef(entry));
						} catch {
							return undefined;
						}
					},
					this.options.fetch,
				),
			);
			this.registrations.set(entry.id, { entry, registration });
		}
		this.entries = next;
	}

	private writeStore(providers: StoredImageProvider[]): void {
		try {
			atomicWriteJSON(this.storePath, { schemaVersion: 1, providers });
		} catch {
			throw new CustomImageProviderError("store-unavailable", "Image service store could not be saved");
		}
	}

	private withStoreLock<T>(action: () => T): T {
		let release: (() => void) | undefined;
		try {
			mkdirSync(dirname(this.storePath), { recursive: true });
			release = lockfile.lockSync(this.storePath, { realpath: false });
			return action();
		} catch (error) {
			if (error instanceof CustomImageProviderError) throw error;
			throw new CustomImageProviderError("store-unavailable", "Image service store is busy or unavailable");
		} finally {
			release?.();
		}
	}

	private cleanupCredential(entry: StoredImageProvider): void {
		try {
			this.vault.remove(credentialRef(entry));
		} catch {
			log.warn("Unused encrypted image credential could not be removed", { id: entry.id });
		}
	}
}
