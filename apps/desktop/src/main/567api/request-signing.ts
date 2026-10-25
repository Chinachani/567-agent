import { createHash, createHmac, randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { getAgent567HomePath } from "@567agent/action-rpc";

// Request identity also runs in the Windows Node RPC host, without Electron safeStorage.
// 混淆加密盐
const SALT_PARTS = ["567", "Api", "Secure", "Token", "2026", "AntiLeech", "v1"];
const CLIENT_SECRET_KEY = createHash("sha256").update(SALT_PARTS.join("::#@!")).digest("hex");
let cachedFingerprint: string | undefined;

/**
 * 获取或持久化生成当前机器的稳定设备唯一指纹
 */
export function getClientFingerprint(): string {
	if (cachedFingerprint) return cachedFingerprint;

	const idFilePath = join(getAgent567HomePath(), "desktop-app", "device-fingerprint.id");
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

/** Only used to read legacy local credentials; new credentials use safeStorage. */
export function deriveLegacyCredentialKey(): Buffer {
	return scryptSync(getClientFingerprint(), CLIENT_SECRET_KEY, 32);
}
