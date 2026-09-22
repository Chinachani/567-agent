import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { join } from "node:path";

interface BytecodeSecurityExports {
	getClientFingerprint?: () => string;
	getSecurityHeaders?: (extraContext?: Record<string, string>) => Record<string, string>;
	encryptSecret?: (plaintext?: string) => string | undefined;
	decryptSecret?: (ciphertext?: string) => string | undefined;
}

let bytecodeExports: BytecodeSecurityExports | null = null;
try {
	const req = createRequire(import.meta.url);
	const loaderPath = join(import.meta.dirname, "567api-security-loader.cjs");
	if (existsSync(loaderPath)) {
		bytecodeExports = req(loaderPath) as BytecodeSecurityExports;
	}
} catch {
	bytecodeExports = null;
}

/**
 * 567 Agent 客户端安全防护、请求指纹与敏感凭据加密模块
 *
 * 核心能力：
 * 1. 采集并计算设备唯一硬件指纹（Device Fingerprint），与本地硬件环境绑定；
 * 2. 为所有发往 567 API 服务端（管理接口与大模型推理接口）的请求附加自定义防伪 Header 与动态 HMAC 签名；
 * 3. 对保存在本地的 Token、Key、Cookie 采用 AES-256-GCM 硬件绑定加密存储，防止用户直接解包或打开配置窃取 Token；
 * 4. 配合 V8 字节码保护，密钥派生与签名算法在二进制中执行，无法通过静态分析逆向。
 */

// 混淆加密盐
const SALT_PARTS = ["567", "Api", "Secure", "Token", "2026", "AntiLeech", "v1"];
const CLIENT_SECRET_KEY = createHash("sha256").update(SALT_PARTS.join("::#@!")).digest("hex");

function getVettaHomePath(): string {
	const explicit = process.env.VETTA_HOME;
	if (explicit) return explicit;
	const dirName = process.env.VETTA_CONFIG_DIR || ".vetta";
	return join(os.homedir(), dirName);
}

let cachedFingerprint: string | undefined;

/**
 * 获取或持久化生成当前机器的稳定设备唯一指纹
 */
export function getClientFingerprint(): string {
	if (bytecodeExports?.getClientFingerprint) {
		try {
			return bytecodeExports.getClientFingerprint();
		} catch {
			// fallback to native implementation
		}
	}
	if (cachedFingerprint) return cachedFingerprint;

	const idFilePath = join(getVettaHomePath(), "desktop-app", "device-fingerprint.id");
	if (existsSync(idFilePath)) {
		try {
			const saved = readFileSync(idFilePath, "utf8").trim();
			if (saved && saved.length >= 32) {
				cachedFingerprint = saved;
				return cachedFingerprint;
			}
		} catch {
			// ignore
		}
	}

	let hardwareBase = "";
	const candidatePaths = ["/etc/machine-id", "/var/lib/dbus/machine-id", "/sys/class/dmi/id/product_uuid"];

	for (const p of candidatePaths) {
		if (existsSync(p)) {
			try {
				const content = readFileSync(p, "utf8").trim();
				if (content) {
					hardwareBase = content;
					break;
				}
			} catch {
				// ignore
			}
		}
	}

	if (!hardwareBase) {
		hardwareBase = `${os.hostname()}_${os.platform()}_${os.arch()}_${os.cpus()[0]?.model ?? ""}`;
	}

	const fp = createHash("sha256").update(`567-agent-device-seed:${hardwareBase}:${os.homedir()}`).digest("hex");

	cachedFingerprint = fp;

	try {
		writeFileSync(idFilePath, fp, { encoding: "utf8", mode: 0o600 });
	} catch {
		// best-effort persistence
	}

	return cachedFingerprint;
}

/**
 * 检查字符串是否含有非 ASCII 字符（如中文或特殊符号）
 */
export function containsNonAscii(str: string): boolean {
	for (let i = 0; i < str.length; i++) {
		if (str.charCodeAt(i) > 127) return true;
	}
	return false;
}

/**
 * 为发往 567 API 的所有请求生成安全防护 Headers
 */
export function getSecurityHeaders(extraContext?: Record<string, string>): Record<string, string> {
	if (bytecodeExports?.getSecurityHeaders) {
		try {
			return bytecodeExports.getSecurityHeaders(extraContext);
		} catch {
			// fallback to native implementation
		}
	}
	const fingerprint = getClientFingerprint();
	const timestamp = String(Math.floor(Date.now() / 1000));
	const nonce = randomBytes(8).toString("hex");
	const clientVersion = "1.0.0";

	// 签名载荷：指纹 + 时间戳 + 随机数 + 客户端版本
	const signPayload = `${fingerprint}:${timestamp}:${nonce}:${clientVersion}`;
	const signature = createHmac("sha256", CLIENT_SECRET_KEY).update(signPayload).digest("hex");

	const headers: Record<string, string> = {
		"X-567-Client": "567-Agent-Desktop",
		"X-567-Version": clientVersion,
		"X-567-Device-Id": fingerprint,
		"X-567-Timestamp": timestamp,
		"X-567-Nonce": nonce,
		"X-567-Signature": signature,
	};

	if (extraContext) {
		for (const [k, v] of Object.entries(extraContext)) {
			if (typeof v === "string") {
				headers[k] = containsNonAscii(v) ? encodeURIComponent(v) : v;
			}
		}
	}

	return headers;
}

/**
 * 获取本机绑定的派生 AES 密钥
 */
function getDerivedKey(): Buffer {
	const fp = getClientFingerprint();
	return scryptSync(fp, CLIENT_SECRET_KEY, 32);
}

/**
 * 本机绑定加密：将敏感 Token / Key / Cookie 加密为密文字符串
 */
export function encryptSecret(plaintext?: string): string | undefined {
	if (bytecodeExports?.encryptSecret) {
		try {
			return bytecodeExports.encryptSecret(plaintext);
		} catch {
			// fallback to native implementation
		}
	}
	if (!plaintext || typeof plaintext !== "string") return plaintext;
	if (plaintext.startsWith("enc:v1:")) return plaintext;

	try {
		const key = getDerivedKey();
		const iv = randomBytes(12);
		const cipher = createCipheriv("aes-256-gcm", key, iv);
		let enc = cipher.update(plaintext, "utf8", "hex");
		enc += cipher.final("hex");
		const tag = cipher.getAuthTag().toString("hex");
		return `enc:v1:${iv.toString("hex")}:${tag}:${enc}`;
	} catch {
		return plaintext;
	}
}

/**
 * 本机绑定解密：解密本地保存的密文 Token
 */
export function decryptSecret(ciphertext?: string): string | undefined {
	if (bytecodeExports?.decryptSecret) {
		try {
			return bytecodeExports.decryptSecret(ciphertext);
		} catch {
			// fallback to native implementation
		}
	}
	if (!ciphertext || typeof ciphertext !== "string") return ciphertext;
	if (!ciphertext.startsWith("enc:v1:")) return ciphertext;

	try {
		const parts = ciphertext.split(":");
		if (parts.length < 5) return ciphertext;
		const iv = Buffer.from(parts[2], "hex");
		const tag = Buffer.from(parts[3], "hex");
		const enc = parts[4];

		const key = getDerivedKey();
		const decipher = createDecipheriv("aes-256-gcm", key, iv);
		decipher.setAuthTag(tag);
		let str = decipher.update(enc, "hex", "utf8");
		str += decipher.final("utf8");
		return str;
	} catch {
		return undefined;
	}
}
