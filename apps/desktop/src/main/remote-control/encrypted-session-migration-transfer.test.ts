import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	EncryptedSessionMigrationTransfer,
	SESSION_MIGRATION_TRANSFER_CHUNK_BYTES,
} from "./encrypted-session-migration-transfer.js";

function digest(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

describe("encrypted session migration transfer", () => {
	it("accepts ordered chunks and an identical retry, then verifies the complete archive", () => {
		const bytes = Buffer.from("encrypted archive bytes");
		const transfer = new EncryptedSessionMigrationTransfer();
		transfer.start({ transferId: "transfer_1234567890", totalBytes: bytes.length, sha256: digest(bytes) });
		const dataBase64 = bytes.toString("base64");
		expect(transfer.append({ transferId: "transfer_1234567890", index: 0, dataBase64 })).toEqual({
			nextChunkIndex: 1,
		});
		expect(transfer.append({ transferId: "transfer_1234567890", index: 0, dataBase64 })).toEqual({
			nextChunkIndex: 1,
		});
		expect(transfer.finish("transfer_1234567890")).toEqual(bytes);
		expect(transfer.cancel()).toBe(false);
	});

	it("rejects out-of-order and conflicting duplicate chunks", () => {
		const bytes = Buffer.alloc(SESSION_MIGRATION_TRANSFER_CHUNK_BYTES + 1, 7);
		const transfer = new EncryptedSessionMigrationTransfer();
		transfer.start({ transferId: "transfer_1234567890", totalBytes: bytes.length, sha256: digest(bytes) });
		expect(() =>
			transfer.append({
				transferId: "transfer_1234567890",
				index: 1,
				dataBase64: Buffer.from([1]).toString("base64"),
			}),
		).toThrow("in order");
		transfer.append({
			transferId: "transfer_1234567890",
			index: 0,
			dataBase64: bytes.subarray(0, SESSION_MIGRATION_TRANSFER_CHUNK_BYTES).toString("base64"),
		});
		expect(() =>
			transfer.append({
				transferId: "transfer_1234567890",
				index: 0,
				dataBase64: Buffer.from("different").toString("base64"),
			}),
		).toThrow("Conflicting duplicate");
	});

	it("rejects corrupt archives, expires idle transfers, and clears on cancellation", () => {
		let now = 0;
		const transfer = new EncryptedSessionMigrationTransfer(() => now);
		transfer.start({ transferId: "transfer_1234567890", totalBytes: 3, sha256: "0".repeat(64) });
		transfer.append({
			transferId: "transfer_1234567890",
			index: 0,
			dataBase64: Buffer.from("abc").toString("base64"),
		});
		expect(() => transfer.finish("transfer_1234567890")).toThrow("checksum");
		transfer.start({ transferId: "transfer_0987654321", totalBytes: 3, sha256: digest(Buffer.from("abc")) });
		now = 10 * 60 * 1000;
		expect(transfer.expireIfNeeded()).toBe(true);
		expect(() => transfer.append({ transferId: "transfer_0987654321", index: 0, dataBase64: "YWJj" })).toThrow(
			"expired",
		);
		transfer.start({ transferId: "transfer_1234567890", totalBytes: 3, sha256: digest(Buffer.from("abc")) });
		expect(transfer.cancel("transfer_1234567890")).toBe(true);
	});

	it("rejects invalid ids, sizes, and chunk bounds", () => {
		const transfer = new EncryptedSessionMigrationTransfer();
		expect(() => transfer.start({ transferId: "short", totalBytes: 10, sha256: "0".repeat(64) })).toThrow(
			"transfer id",
		);
		expect(() =>
			transfer.start({ transferId: "transfer_1234567890", totalBytes: 0, sha256: "0".repeat(64) }),
		).toThrow("size");
		transfer.start({ transferId: "transfer_1234567890", totalBytes: 10, sha256: "0".repeat(64) });
		expect(() => transfer.append({ transferId: "transfer_1234567890", index: 0, dataBase64: "!" })).toThrow(
			"encoding",
		);
	});
});
