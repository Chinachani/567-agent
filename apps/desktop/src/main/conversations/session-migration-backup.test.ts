import { createCipheriv, pbkdf2Sync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	decryptSessionMigrationArchive,
	encryptSessionMigrationArchive,
	parseSessionMigrationArchive,
} from "./session-migration-backup.js";

describe("session migration backup", () => {
	it("decrypts a backup written with the Android PBKDF2 and AES-GCM envelope", () => {
		const passphrase = "test-password-567";
		const plaintext = Buffer.from(
			JSON.stringify({
				schemaVersion: 1,
				exportedAtEpochMs: 1_760_000_000_000,
				sessions: [{ id: "mobile-session", title: "Mobile chat", createdAtEpochMs: 1, updatedAtEpochMs: 2 }],
				messages: [
					{
						sessionId: "mobile-session",
						items: [
							{
								id: "message-1",
								sessionId: "mobile-session",
								role: "user",
								content: "hello",
								status: "Complete",
								createdAtEpochMs: 2,
							},
						],
					},
				],
			}),
		);
		const salt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
		const nonce = Buffer.from("00112233445566778899aabb", "hex");
		const key = deriveAndroidCompatibleKey(passphrase, salt);
		const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
		const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
		const androidArchive = Buffer.concat([Buffer.from("567CHATBACKUP1"), salt, nonce, encrypted]);
		expect(decryptSessionMigrationArchive(androidArchive, passphrase)).toEqual(plaintext);
	});

	it("round trips a validated mobile archive and rejects a wrong password", () => {
		const plaintext = Buffer.from(
			JSON.stringify({
				schemaVersion: 1,
				exportedAtEpochMs: 1,
				sessions: [{ id: "mobile-session", title: "Mobile chat", createdAtEpochMs: 1, updatedAtEpochMs: 2 }],
				messages: [{ sessionId: "mobile-session", items: [] }],
			}),
		);
		const archive = encryptSessionMigrationArchive(plaintext, "passphrase-567");
		expect(
			parseSessionMigrationArchive(decryptSessionMigrationArchive(archive, "passphrase-567")).sessions[0]?.title,
		).toBe("Mobile chat");
		expect(() => decryptSessionMigrationArchive(archive, "wrong-password")).toThrow(/password is incorrect/i);
	});

	it("preserves the underlying authentication failure and rejects empty plaintext archives", () => {
		const emptyArchive = encryptSessionMigrationArchive(Buffer.alloc(0), "passphrase-567");
		expect(() => decryptSessionMigrationArchive(emptyArchive, "passphrase-567")).toThrow(
			/This is not a supported 567 Agent migration backup/i,
		);

		const valid = encryptSessionMigrationArchive(Buffer.from("{}"), "passphrase-567");
		try {
			decryptSessionMigrationArchive(valid, "wrong-password");
		} catch (error) {
			expect(error).toMatchObject({
				message: "The password is incorrect or the migration backup is damaged",
				cause: expect.any(Error),
			});
		}
	});

	it("rejects duplicate sessions and unknown message references", () => {
		const duplicate = {
			schemaVersion: 1,
			exportedAtEpochMs: 1,
			sessions: [
				{ id: "same", title: "A", createdAtEpochMs: 1, updatedAtEpochMs: 1 },
				{ id: "same", title: "B", createdAtEpochMs: 1, updatedAtEpochMs: 1 },
			],
			messages: [],
		};
		expect(() => parseSessionMigrationArchive(Buffer.from(JSON.stringify(duplicate)))).toThrow(/duplicate sessions/i);
	});
});

function deriveAndroidCompatibleKey(passphrase: string, salt: Uint8Array): Buffer {
	return pbkdf2Sync(passphrase, salt, 600_000, 32, "sha256");
}
