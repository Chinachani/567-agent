import type { CredentialVault } from "../credentials/credential-vault.js";

const ACCOUNT_CREDENTIAL_REF = {
	namespace: "567api",
	ownerId: "account",
	name: "password-login",
} as const;

export interface AccountCredentials {
	readonly username: string;
	readonly password: string;
}

export function saveAccountCredentials(vault: CredentialVault, credentials: AccountCredentials): boolean {
	if (!vault.isAvailable()) return false;
	vault.put(ACCOUNT_CREDENTIAL_REF, JSON.stringify(credentials));
	return true;
}

export function loadAccountCredentials(vault: CredentialVault): AccountCredentials | undefined {
	if (!vault.isAvailable()) return undefined;
	const value = vault.get(ACCOUNT_CREDENTIAL_REF);
	if (!value) return undefined;
	try {
		const parsed: unknown = JSON.parse(value);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			"username" in parsed &&
			typeof parsed.username === "string" &&
			"password" in parsed &&
			typeof parsed.password === "string" &&
			parsed.username.trim() &&
			parsed.password
		) {
			return { username: parsed.username, password: parsed.password };
		}
	} catch {
		// A malformed saved login is not usable; keep it for diagnostics/recovery.
	}
	return undefined;
}

export function removeAccountCredentials(vault: CredentialVault): void {
	vault.remove(ACCOUNT_CREDENTIAL_REF);
}
