import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type CredentialCryptography, CredentialVault } from "../credentials/credential-vault.js";
import { loadAccountCredentials, removeAccountCredentials, saveAccountCredentials } from "./account-credentials.js";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("saved 567 API account credentials", () => {
	it("round-trips only through the encrypted credential vault", () => {
		const root = temporaryDirectory();
		const vault = new CredentialVault(root, new TestCryptography());
		const credentials = { username: "user@example.com", password: "private-password" };

		expect(saveAccountCredentials(vault, credentials)).toBe(true);
		expect(loadAccountCredentials(vault)).toEqual(credentials);
		const record = readFileSync(join(root, readdirSync(root)[0] ?? ""), "utf8");
		expect(record).not.toContain(credentials.password);
		removeAccountCredentials(vault);
		expect(loadAccountCredentials(vault)).toBeUndefined();
	});

	it("refuses to persist a password when secure storage is unavailable", () => {
		const vault = new CredentialVault(temporaryDirectory(), new TestCryptography(false));
		expect(saveAccountCredentials(vault, { username: "user", password: "secret" })).toBe(false);
	});

	it("ignores malformed encrypted values without deleting the record", () => {
		const root = temporaryDirectory();
		const vault = new CredentialVault(root, new TestCryptography());
		vault.put({ namespace: "567api", ownerId: "account", name: "password-login" }, "not-json");

		expect(loadAccountCredentials(vault)).toBeUndefined();
		expect(vault.listRefs("567api")).toHaveLength(1);
	});
});

class TestCryptography implements CredentialCryptography {
	readonly backend = "test";

	constructor(private readonly available = true) {}

	isAvailable(): boolean {
		return this.available;
	}

	encrypt(value: string): string {
		return Buffer.from(value).toString("base64");
	}

	decrypt(value: string): string {
		return Buffer.from(value, "base64").toString("utf8");
	}
}

function temporaryDirectory(): string {
	const root = mkdtempSync(join(tmpdir(), "567-account-credentials-"));
	roots.push(root);
	return root;
}
