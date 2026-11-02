/** A bounded source preview, never a binary document interpreted as plain text. */
export function attachmentTextPreview(bytes: Uint8Array, truncated = false): string | undefined {
	const prefix = Buffer.from(bytes.subarray(0, 8)).toString("latin1");
	if (/^(%PDF-|PK\x03\x04|\xd0\xcf\x11\xe0|\x89PNG|GIF8|\xff\xd8\xff|RIFF|\{\\rtf)/.test(prefix)) return undefined;
	const encoding =
		bytes[0] === 0xff && bytes[1] === 0xfe
			? "utf-16le"
			: bytes[0] === 0xfe && bytes[1] === 0xff
				? "utf-16be"
				: "utf-8";
	try {
		const text = new TextDecoder(encoding, { fatal: true }).decode(bytes, { stream: truncated });
		return /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(text) ? undefined : text;
	} catch {
		return undefined;
	}
}
