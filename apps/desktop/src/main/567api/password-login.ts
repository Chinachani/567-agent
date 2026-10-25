import type { KeyObject } from "node:crypto";
import { constants, createCipheriv, createHash, createPublicKey, publicEncrypt, randomBytes } from "node:crypto";

export class PasswordLoginEncryptionError extends Error {}

export interface PasswordLoginPayload {
	username: string;
	password?: string;
	password_encrypted?: string;
	encryption_key_id?: string;
}

/** New API rc.45 hybrid envelope. A failed handshake must never downgrade to plaintext. */
export function preparePasswordLogin(
	username: string,
	password: string,
	response: { status: number; data: unknown },
): PasswordLoginPayload {
	if (response.status === 404 || response.status === 405) return { username, password };
	if (response.status !== 200 || !response.data || typeof response.data !== "object") {
		throw new PasswordLoginEncryptionError("Password login encryption handshake failed");
	}
	const envelope = response.data as { success?: unknown; data?: unknown };
	if (envelope.success !== true || !envelope.data || typeof envelope.data !== "object") {
		throw new PasswordLoginEncryptionError("Password login encryption handshake failed");
	}
	const config = envelope.data as { enabled?: unknown; kid?: unknown; public_key?: unknown };
	if (config.enabled === false) return { username, password };
	if (
		config.enabled !== true ||
		typeof config.kid !== "string" ||
		!/^[a-f0-9]{32}$/.test(config.kid) ||
		typeof config.public_key !== "string" ||
		config.public_key.length > 16_384
	) {
		throw new PasswordLoginEncryptionError("Password login encryption handshake failed");
	}
	let publicKey: KeyObject;
	try {
		publicKey = createPublicKey(config.public_key);
	} catch {
		throw new PasswordLoginEncryptionError("Password login encryption handshake failed");
	}
	const der = publicKey.export({ type: "spki", format: "der" });
	if (
		publicKey.asymmetricKeyType !== "rsa" ||
		(publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
		createHash("sha256").update(der).digest("hex").slice(0, 32) !== config.kid
	) {
		throw new PasswordLoginEncryptionError("Password login encryption handshake failed");
	}
	const key = randomBytes(32);
	const nonce = randomBytes(12);
	try {
		const cipher = createCipheriv("aes-256-gcm", key, nonce);
		cipher.setAAD(Buffer.from(`password-v2:${config.kid}`, "utf8"));
		const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final(), cipher.getAuthTag()]);
		const wrapped = publicEncrypt(
			{
				key: publicKey,
				padding: constants.RSA_PKCS1_OAEP_PADDING,
				oaepHash: "sha256",
				oaepLabel: Buffer.from("password-v2"),
			},
			key,
		);
		return {
			username,
			password_encrypted: `v2.${wrapped.toString("base64")}.${nonce.toString("base64")}.${ciphertext.toString("base64")}`,
			encryption_key_id: config.kid,
		};
	} finally {
		key.fill(0);
	}
}
