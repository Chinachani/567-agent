import { createHash, createPublicKey, verify } from "node:crypto";
import AdmZip from "adm-zip";
import catalog from "../../../resources/browser-extension/catalog.json";

export { catalog as browserExtensionCatalog };

function fields(bytes: Buffer): { id: number; data: Buffer }[] {
	let cursor = 0;
	const integer = (): number => {
		let value = 0;
		for (let shift = 0; shift <= 28; shift += 7) {
			const byte = bytes[cursor++];
			if (byte === undefined) throw new Error("Invalid CRX header");
			value += (byte & 127) * 2 ** shift;
			if (!(byte & 128)) return value;
		}
		throw new Error("Invalid CRX integer");
	};
	const result: { id: number; data: Buffer }[] = [];
	while (cursor < bytes.length) {
		const tag = integer();
		if ((tag & 7) !== 2) throw new Error("Invalid CRX field");
		const size = integer();
		if (cursor + size > bytes.length) throw new Error("Truncated CRX header");
		result.push({ id: Math.floor(tag / 8), data: bytes.subarray(cursor, cursor + size) });
		cursor += size;
	}
	return result;
}

function extensionId(key: Buffer): string {
	return [...createHash("sha256").update(key).digest().subarray(0, 16)]
		.map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
		.join("");
}

/** The checked-in publisher-signed CRX is the only accepted source; no runtime downloads. */
export function readBundledExtension(bytes: Buffer): Map<string, Buffer> {
	if (bytes.length !== catalog.bytes || createHash("sha256").update(bytes).digest("hex") !== catalog.sha256) {
		throw new Error("Browser extension checksum mismatch");
	}
	if (bytes.toString("ascii", 0, 4) !== "Cr24" || bytes.readUInt32LE(4) !== 3) throw new Error("Invalid CRX");
	const offset = 12 + bytes.readUInt32LE(8);
	const header = fields(bytes.subarray(12, offset));
	const signed = header.find((field) => field.id === 10000)?.data;
	if (!signed) throw new Error("Unsigned CRX");
	const length = Buffer.alloc(4);
	length.writeUInt32LE(signed.length);
	const zip = bytes.subarray(offset);
	const payload = Buffer.concat([Buffer.from("CRX3 SignedData\0"), length, signed, zip]);
	const signedId = fields(signed).find((field) => field.id === 1)?.data;
	const valid = header
		.filter((field) => field.id === 2 || field.id === 3)
		.some((field) => {
			const proof = fields(field.data);
			const key = proof.find((entry) => entry.id === 1)?.data;
			const signature = proof.find((entry) => entry.id === 2)?.data;
			return (
				key &&
				signature &&
				extensionId(key) === catalog.extensionId &&
				createHash("sha256")
					.update(key)
					.digest()
					.subarray(0, 16)
					.equals(signedId ?? Buffer.alloc(0)) &&
				verify("sha256", payload, createPublicKey({ key, format: "der", type: "spki" }), signature)
			);
		});
	if (!valid) throw new Error("Invalid browser extension publisher signature");
	const files = new Map<string, Buffer>();
	let total = 0;
	for (const entry of new AdmZip(zip).getEntries()) {
		// Chromium rejects its store-only reserved metadata when loading an unpacked extension.
		if (entry.isDirectory || entry.entryName.startsWith("_metadata/")) continue;
		if (
			!/^[\w.-]+(?:\/[\w.-]+)*$/.test(entry.entryName) ||
			entry.entryName.split("/").includes("..") ||
			((entry.header.attr >>> 16) & 0o170000) === 0o120000 ||
			files.has(entry.entryName)
		) {
			throw new Error("Invalid browser extension entry");
		}
		total += entry.header.size;
		if (total > 5 * 1024 * 1024) throw new Error("Browser extension is too large");
		files.set(entry.entryName, entry.getData());
	}
	const manifest: unknown = JSON.parse(files.get("manifest.json")?.toString("utf8") ?? "null");
	if (
		!manifest ||
		typeof manifest !== "object" ||
		!("version" in manifest) ||
		manifest.version !== catalog.version ||
		!("key" in manifest) ||
		typeof manifest.key !== "string" ||
		extensionId(Buffer.from(manifest.key, "base64")) !== catalog.extensionId
	) {
		throw new Error("Browser extension identity mismatch");
	}
	return files;
}
