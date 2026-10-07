import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type * as NodeOs from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

let syncCredentialFile: typeof import("./credential-store.js")["syncCredentialFile"];
let loadVettaCredentials: typeof import("@567agent/runtime-node/mcp")["loadVettaCredentials"];
let vettaCredentialsPath: typeof import("@567agent/runtime-node/mcp")["vettaCredentialsPath"];

const isolated = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (importOriginal) => ({
	...(await importOriginal<typeof NodeOs>()),
	homedir: () => isolated.home,
}));
vi.mock("../../logger.js", () => ({ getAppLogger: () => ({ warn: () => {} }) }));

// The public MCP entry loads its complete dependency graph. Keep that transform
// cost in suite setup so the actual filesystem round trip retains a short limit.
beforeAll(async () => {
	({ syncCredentialFile } = await import("./credential-store.js"));
	({ loadVettaCredentials, vettaCredentialsPath } = await import("@567agent/runtime-node/mcp"));
}, 30_000);

beforeEach(() => {
	isolated.home = mkdtempSync(join(tmpdir(), "567-auth-home-"));
	for (const name of [
		"AGENT567_HOME",
		"AGENT567_CONFIG_DIR",
		"API567_API_TOKEN",
		"API567_BASE_URL",
		"API567_BASE_URL",
	])
		vi.stubEnv(name, "");
	vi.stubEnv("API567_BASE_URL", "https://test.invalid");
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(isolated.home, { recursive: true, force: true });
});

it("writes, rotates, reads, and removes MCP credentials in the branded home without recreating the old directory", async () => {
	expect(vettaCredentialsPath()).toBe(join(isolated.home, ".567agent", "auth.json"));
	syncCredentialFile("first-synthetic-token");
	expect(loadVettaCredentials()?.token).toBe("first-synthetic-token");
	syncCredentialFile("rotated-synthetic-token");
	expect(loadVettaCredentials()?.token).toBe("rotated-synthetic-token");
	expect(existsSync(join(isolated.home, ".vetta"))).toBe(false);
	syncCredentialFile(undefined);
	expect(loadVettaCredentials()).toBeNull();
});
