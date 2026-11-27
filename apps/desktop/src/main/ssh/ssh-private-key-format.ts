import { createPrivateKey } from "node:crypto";

const OPENSSH_MAGIC = Buffer.from("openssh-key-v1\0");
const PRIVATE_KEY_ARMOR =
	/^-----BEGIN ((?:(?:OPENSSH|RSA|DSA|EC|ENCRYPTED) )?PRIVATE KEY)-----\r?\n([\s\S]+)\r?\n-----END \1-----$/;
const SSH_KEY_TYPES =
	/^(ssh-(rsa|dss|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)$/;
const SSH_CIPHERS =
	/^(aes(128|192|256)-(ctr|cbc)|aes(128|256)-gcm@openssh\.com|chacha20-poly1305@openssh\.com|3des-cbc)$/;
const PEM_TYPES = new Set(["rsa", "dsa", "ec", "ed25519"]);

class SshKeyReader {
	private offset = 0;

	constructor(private readonly bytes: Buffer) {}

	get remaining(): number {
		return this.bytes.length - this.offset;
	}

	uint32(): number {
		const value = this.bytes.readUInt32BE(this.offset);
		this.offset += 4;
		return value;
	}

	string(): Buffer {
		const length = this.uint32();
		if (length > this.remaining) throw new RangeError("Truncated SSH field");
		const start = this.offset;
		this.offset += length;
		return this.bytes.subarray(start, this.offset);
	}

	byte(): number {
		return this.bytes.readUInt8(this.offset++);
	}
}

function readPublicFields(reader: SshKeyReader, type: string): Buffer[] {
	let fieldCount = 1;
	if (type === "ssh-dss") fieldCount = 4;
	else if (type === "ssh-rsa" || type.startsWith("ecdsa-") || type.startsWith("sk-ssh-")) fieldCount = 2;
	else if (type.startsWith("sk-ecdsa-")) fieldCount = 3;
	return Array.from({ length: fieldCount }, () => reader.string());
}

function isClearOpenSshKey(bytes: Buffer, type: string, publicFields: Buffer[]): boolean {
	if (bytes.length % 8 !== 0) return false;
	const reader = new SshKeyReader(bytes);
	const firstCheck = reader.uint32();
	if (firstCheck !== reader.uint32() || reader.string().toString() !== type) return false;
	const fields = readPublicFields(reader, type);
	if (type === "ssh-rsa") fields.reverse();
	if (!fields.every((field, index) => field.equals(publicFields[index]!))) return false;
	if (type.startsWith("sk-")) {
		reader.byte();
		if (reader.string().length === 0) return false;
		reader.string();
	} else {
		const secret = reader.string();
		if (secret.length === 0) return false;
		if (type === "ssh-ed25519" && (secret.length !== 64 || !secret.subarray(32).equals(publicFields[0]!)))
			return false;
		if (type === "ssh-rsa" && [reader.string(), reader.string(), reader.string()].some((field) => field.length === 0))
			return false;
	}
	reader.string();
	if (reader.remaining >= 8) return false;
	for (let padding = 1; reader.remaining > 0; padding++) {
		if (reader.byte() !== padding) return false;
	}
	return true;
}

function isOpenSshKey(encoded: string): boolean {
	const base64 = encoded.replace(/[\r\n]/g, "");
	const bytes = Buffer.from(base64, "base64");
	try {
		if (bytes.toString("base64") !== base64 || !bytes.subarray(0, OPENSSH_MAGIC.length).equals(OPENSSH_MAGIC))
			return false;
		const reader = new SshKeyReader(bytes.subarray(OPENSSH_MAGIC.length));
		const cipher = reader.string().toString();
		const kdf = reader.string().toString();
		const kdfOptions = reader.string();
		if (reader.uint32() !== 1) return false;
		const publicKey = new SshKeyReader(reader.string());
		const type = publicKey.string().toString();
		if (!SSH_KEY_TYPES.test(type)) return false;
		const fields = readPublicFields(publicKey, type);
		if (publicKey.remaining !== 0 || fields.some((field) => field.length === 0)) return false;
		const ed25519 = type === "ssh-ed25519" || type === "sk-ssh-ed25519@openssh.com";
		if (ed25519 && fields[0]?.length !== 32) return false;
		const privateKey = reader.string();
		if (cipher === "none") {
			return (
				kdf === "none" &&
				kdfOptions.length === 0 &&
				reader.remaining === 0 &&
				isClearOpenSshKey(privateKey, type, fields)
			);
		}
		if (kdf !== "bcrypt" || !SSH_CIPHERS.test(cipher)) return false;
		const options = new SshKeyReader(kdfOptions);
		const blockSize = cipher.startsWith("aes") ? 16 : 8;
		const authSize = cipher.endsWith("@openssh.com") ? 16 : 0;
		return (
			options.string().length > 0 &&
			options.uint32() > 0 &&
			options.remaining === 0 &&
			privateKey.length >= blockSize &&
			privateKey.length % blockSize === 0 &&
			reader.remaining === authSize
		);
	} catch {
		return false;
	} finally {
		bytes.fill(0);
	}
}

export function normalizeSshPrivateKey(bytes: Buffer): Buffer | undefined {
	const original = bytes.toString("utf8");
	const text = original.trim();
	const armor = PRIVATE_KEY_ARMOR.exec(text);
	if (!armor) return undefined;
	const [, type, body] = armor;
	if (!body || body.includes("-----")) return undefined;
	if (type === "OPENSSH PRIVATE KEY") {
		if (!/^[A-Za-z0-9+/=\r\n]+$/.test(body) || !isOpenSshKey(body)) return undefined;
		const normalized = `${text.replaceAll("\r", "")}\n`;
		return normalized === original ? bytes : Buffer.from(normalized);
	}
	try {
		return PEM_TYPES.has(createPrivateKey(bytes).asymmetricKeyType ?? "") ? bytes : undefined;
	} catch (error) {
		const encrypted =
			error instanceof Error &&
			"code" in error &&
			error.code === "ERR_OSSL_CRYPTO_INTERRUPTED_OR_CANCELLED" &&
			(type === "ENCRYPTED PRIVATE KEY" || body.startsWith("Proc-Type: 4,ENCRYPTED"));
		return encrypted ? bytes : undefined;
	}
}
