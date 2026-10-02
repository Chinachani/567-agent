import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type * as NodeOs from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const isolated = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (importOriginal) => ({
	...(await importOriginal<typeof NodeOs>()),
	homedir: () => isolated.home,
}));
vi.mock("../../logger.js", () => ({ getAppLogger: () => ({ warn: () => {} }) }));

beforeEach(() => {
	vi.resetModules();
	isolated.home = mkdtempSync(join(tmpdir(), "567-auth-home-"));
	for (const name of ["VETTA_HOME", "VETTA_CONFIG_DIR", "VETTA_API_TOKEN", "VETTA_API_BASE_URL", "VETTA_SERVER_URL"])
		vi.stubEnv(name, "");
	vi.stubEnv("VETTA_SERVER_URL", "https://test.invalid");
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(isolated.home, { recursive: true, force: true });
});

it("writes, rotates, reads, and removes MCP credentials in the branded home without recreating the old directory", async () => {
	const { syncCredentialFile } = await import("./credential-store.js");
	const { loadVettaCredentials, vettaCredentialsPath } = await import("@vetta/runtime-node/mcp");
	expect(vettaCredentialsPath()).toBe(join(isolated.home, ".567agent", "auth.json"));
	syncCredentialFile("first-synthetic-token");
	expect(loadVettaCredentials()?.token).toBe("first-synthetic-token");
	syncCredentialFile("rotated-synthetic-token");
	expect(loadVettaCredentials()?.token).toBe("rotated-synthetic-token");
	expect(existsSync(join(isolated.home, ".vetta"))).toBe(false);
	syncCredentialFile(undefined);
	expect(loadVettaCredentials()).toBeNull();
});
