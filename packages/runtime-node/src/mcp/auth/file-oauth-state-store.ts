import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	type McpOAuthStateStore,
	type McpOAuthStoredState,
	parseMcpOAuthStoredState,
} from "@567agent/runtime-mcp/auth";

export interface FileMcpOAuthStateStoreOptions {
	/** Explicit credential directory; product-specific directory resolution stays in the caller. */
	readonly authDirectory: string;
}

/** File-backed OAuth state adapter with no product-specific path defaults. */
export class FileMcpOAuthStateStore implements McpOAuthStateStore {
	constructor(private readonly options: FileMcpOAuthStateStoreOptions) {}

	getPath(serverName: string): string {
		const identity = createHash("sha256").update(serverName.trim()).digest("hex").slice(0, 24);
		return join(this.options.authDirectory, `${sanitizeServerName(serverName)}-${identity}.json`);
	}

	load(serverName: string): McpOAuthStoredState | undefined {
		const path = this.getPath(serverName);
		const state =
			this.readState(path) ??
			this.readState(join(this.options.authDirectory, `${sanitizeServerName(serverName)}.json`));
		if (state && !existsSync(path)) this.save(serverName, state);
		return state;
	}

	save(serverName: string, state: McpOAuthStoredState): void {
		mkdirSync(this.options.authDirectory, { recursive: true });
		const payload: McpOAuthStoredState = {
			...state,
			updatedAt: new Date().toISOString(),
		};
		writeFileSync(this.getPath(serverName), `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
	}

	clear(serverName: string): void {
		const path = this.getPath(serverName);
		if (existsSync(path)) unlinkSync(path);
	}

	hasTokens(serverName: string): boolean {
		const state = this.load(serverName);
		return Boolean(state?.tokens?.access_token || state?.tokens?.refresh_token);
	}

	private readState(path: string): McpOAuthStoredState | undefined {
		if (!existsSync(path)) return undefined;
		try {
			return parseMcpOAuthStoredState(JSON.parse(readFileSync(path, "utf-8")));
		} catch {
			return undefined;
		}
	}
}

function sanitizeServerName(serverName: string): string {
	const cleaned = serverName.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
	return cleaned.length > 0 ? cleaned : "server";
}
