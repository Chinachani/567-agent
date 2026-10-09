import { join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";
import { CredentialVault } from "./credential-vault.js";
import { ElectronSafeStorageCryptography } from "./electron-safe-storage-cryptography.js";

let desktopCredentialVault: CredentialVault | undefined;

export function getDesktopCredentialVault(): CredentialVault {
	desktopCredentialVault ??= new CredentialVault(
		join(getAgent567HomePath(), "desktop-app", "credentials"),
		new ElectronSafeStorageCryptography(),
	);
	return desktopCredentialVault;
}
