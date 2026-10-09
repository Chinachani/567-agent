import { createHash } from "node:crypto";

export const SESSION_MIGRATION_TRANSFER_CHUNK_BYTES = 256 * 1024;
const TRANSFER_TTL_MS = 10 * 60 * 1000;

interface ActiveTransfer {
	id: string;
	totalBytes: number;
	expectedSha256: string;
	buffer: Buffer;
	nextChunkIndex: number;
	lastChunk?: { index: number; offset: number; bytes: Buffer };
	updatedAt: number;
}

export class EncryptedSessionMigrationTransfer {
	private active: ActiveTransfer | undefined;

	constructor(
		private readonly now: () => number = Date.now,
		private readonly chunkBytes = SESSION_MIGRATION_TRANSFER_CHUNK_BYTES,
	) {}

	start(input: { transferId: string; totalBytes: number; sha256: string }): void {
		this.expireIfNeeded();
		if (this.active) throw new Error("A conversation transfer is already in progress");
		if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.transferId)) throw new Error("Invalid transfer id");
		if (!Number.isSafeInteger(input.totalBytes) || input.totalBytes < 1 || input.totalBytes > 200 * 1024 * 1024) {
			throw new Error("Conversation backup size is invalid or exceeds 200 MB");
		}
		if (!/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("Invalid transfer checksum");
		this.active = {
			id: input.transferId,
			totalBytes: input.totalBytes,
			expectedSha256: input.sha256,
			buffer: Buffer.alloc(input.totalBytes),
			nextChunkIndex: 0,
			updatedAt: this.now(),
		};
	}

	append(input: { transferId: string; index: number; dataBase64: string }): { nextChunkIndex: number } {
		const transfer = this.requireActive(input.transferId);
		if (!Number.isSafeInteger(input.index) || input.index < 0) throw new Error("Invalid chunk index");
		const bytes = decodeChunk(input.dataBase64);
		if (bytes.byteLength > this.chunkBytes) throw new Error("Conversation chunk is too large");

		if (input.index === transfer.nextChunkIndex - 1 && transfer.lastChunk) {
			const previous = transfer.lastChunk;
			if (previous.index !== input.index || !previous.bytes.equals(bytes)) {
				bytes.fill(0);
				throw new Error("Conflicting duplicate conversation chunk");
			}
			bytes.fill(0);
			transfer.updatedAt = this.now();
			return { nextChunkIndex: transfer.nextChunkIndex };
		}
		if (input.index !== transfer.nextChunkIndex) {
			bytes.fill(0);
			throw new Error("Conversation chunks must arrive in order");
		}
		const offset = input.index * this.chunkBytes;
		if (offset + bytes.byteLength > transfer.totalBytes || bytes.byteLength === 0) {
			bytes.fill(0);
			throw new Error("Conversation chunk exceeds the declared archive size");
		}
		transfer.lastChunk?.bytes.fill(0);
		bytes.copy(transfer.buffer, offset);
		transfer.lastChunk = { index: input.index, offset, bytes: Buffer.from(bytes) };
		transfer.nextChunkIndex += 1;
		transfer.updatedAt = this.now();
		bytes.fill(0);
		return { nextChunkIndex: transfer.nextChunkIndex };
	}

	finish(transferId: string): Buffer {
		const transfer = this.requireActive(transferId);
		if (
			!transfer.lastChunk ||
			transfer.lastChunk.offset + transfer.lastChunk.bytes.byteLength !== transfer.totalBytes
		) {
			throw new Error("Conversation backup is incomplete");
		}
		const digest = createHash("sha256").update(transfer.buffer).digest("hex");
		if (digest !== transfer.expectedSha256) {
			this.clear();
			throw new Error("Conversation backup checksum does not match");
		}
		const result = Buffer.from(transfer.buffer);
		this.clear();
		return result;
	}

	cancel(transferId?: string): boolean {
		if (!this.active || (transferId !== undefined && this.active.id !== transferId)) return false;
		this.clear();
		return true;
	}

	expireIfNeeded(): boolean {
		if (!this.active || this.now() - this.active.updatedAt < TRANSFER_TTL_MS) return false;
		this.clear();
		return true;
	}

	private requireActive(transferId: string): ActiveTransfer {
		this.expireIfNeeded();
		if (!this.active || this.active.id !== transferId)
			throw new Error("Conversation transfer was not found or expired");
		return this.active;
	}

	private clear(): void {
		this.active?.buffer.fill(0);
		this.active?.lastChunk?.bytes.fill(0);
		this.active = undefined;
	}
}

function decodeChunk(value: string): Buffer {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 350_000 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(value)
	) {
		throw new Error("Invalid conversation chunk encoding");
	}
	const bytes = Buffer.from(value, "base64");
	if (bytes.toString("base64") !== value) {
		bytes.fill(0);
		throw new Error("Invalid conversation chunk encoding");
	}
	return bytes;
}
