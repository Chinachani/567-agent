import { createDecipheriv } from "node:crypto";
import { ElectronSafeStorageCryptography } from "../credentials/electron-safe-storage-cryptography.js";
import { deriveLegacyCredentialKey } from "./request-signing.js";

export { containsNonAscii, getClientFingerprint, getSecurityHeaders } from "./request-signing.js";

const secureStorage = new ElectronSafeStorageCryptography();

export function isSecureCredentialStorageAvailable(): boolean {
	return secureStorage.isAvailable();
}

/**
 * OS-backed 加密：将敏感 Token / Key / Cookie 加密为密文字符串。
 * 若系统安全存储不可用则失败关闭，不能把明文当作加密结果返回。
 */
export function encryptSecret(plaintext?: string): string | undefined {
	if (!plaintext || typeof plaintext !== "string") return plaintext;
	if (plaintext.startsWith("enc:v2:")) return plaintext;

	try {
		if (!secureStorage.isAvailable()) throw new Error("Secure credential storage is unavailable");
		return `enc:v2:${secureStorage.encrypt(plaintext)}`;
	} catch {
		throw new Error("Unable to encrypt 567 API credentials with OS-backed secure storage");
	}
}

/**
 * 本机绑定解密：解密本地保存的密文 Token
 */
export function decryptSecret(ciphertext?: string): string | undefined {
	if (!ciphertext || typeof ciphertext !== "string") return ciphertext;
	if (ciphertext.startsWith("enc:v2:")) {
		try {
			if (!secureStorage.isAvailable()) return undefined;
			return secureStorage.decrypt(ciphertext.slice("enc:v2:".length));
		} catch {
			return undefined;
		}
	}
	if (!ciphertext.startsWith("enc:v1:")) return ciphertext.startsWith("enc:") ? undefined : ciphertext;

	try {
		const parts = ciphertext.split(":");
		if (parts.length !== 5 || !/^[0-9a-f]+$/i.test(parts[2]) || !/^[0-9a-f]+$/i.test(parts[3])) {
			return undefined;
		}
		const iv = Buffer.from(parts[2], "hex");
		const tag = Buffer.from(parts[3], "hex");
		const enc = parts[4];

		const key = deriveLegacyCredentialKey();
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		let str = decipher.update(enc, "hex", "utf8");
		str += decipher.final("utf8");
		return str;
	} catch {
		return undefined;
	}
}
