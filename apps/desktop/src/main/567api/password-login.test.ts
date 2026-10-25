import { constants, createDecipheriv, createHash, generateKeyPairSync, privateDecrypt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { preparePasswordLogin } from "./password-login.js";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = createHash("sha256")
	.update(pair.publicKey.export({ type: "spki", format: "der" }))
	.digest("hex")
	.slice(0, 32);
const config = {
	status: 200,
	data: {
		success: true,
		data: { enabled: true, kid, public_key: pair.publicKey.export({ type: "spki", format: "pem" }).toString() },
	},
};

describe("New API password login", () => {
	it("encrypts long Unicode passwords with a fresh rc.45-compatible envelope on every login", () => {
		const password = "密码长内容🔑".repeat(40);
		const payload = preparePasswordLogin("user", password, config);
		expect(payload.password).toBeUndefined();
		expect(payload.encryption_key_id).toBe(kid);
		const parts = payload.password_encrypted?.split(".") ?? [];
		expect(parts).toHaveLength(4);
		const key = privateDecrypt(
			{
				key: pair.privateKey,
				padding: constants.RSA_PKCS1_OAEP_PADDING,
				oaepHash: "sha256",
				oaepLabel: Buffer.from("password-v2"),
			},
			Buffer.from(parts[1] ?? "", "base64"),
		);
		const sealed = Buffer.from(parts[3] ?? "", "base64");
		const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2] ?? "", "base64"));
		decipher.setAAD(Buffer.from(`password-v2:${kid}`));
		decipher.setAuthTag(sealed.subarray(-16));
		expect(Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]).toString()).toBe(password);
		expect(preparePasswordLogin("user", password, config).password_encrypted).not.toBe(payload.password_encrypted);
	});

	it("keeps explicitly disabled and older server login compatible", () => {
		for (const response of [
			{ status: 404, data: null },
			{ status: 200, data: { success: true, data: { enabled: false } } },
		]) {
			expect(preparePasswordLogin("user", "password", response)).toEqual({ username: "user", password: "password" });
		}
	});

	it("does not downgrade after server errors, malformed keys or key ID mismatch", () => {
		for (const response of [
			{ status: 503, data: null },
			{ status: 200, data: { success: false } },
			{ ...config, data: { success: true, data: { ...config.data.data, kid: "0".repeat(32) } } },
			{ ...config, data: { success: true, data: { ...config.data.data, public_key: "invalid PEM" } } },
		]) {
			expect(() => preparePasswordLogin("user", "password", response)).toThrow();
		}
	});
});
