import QRCode from "qrcode";

/** Render through the library's SVG path so QR creation does not depend on a canvas implementation. */
export async function createQrCodeDataUrl(value: string, width = 240): Promise<string> {
	const svg = await QRCode.toString(value, {
		type: "svg",
		errorCorrectionLevel: "M",
		margin: 1,
		width,
		color: { dark: "#000000", light: "#ffffff" },
	});
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
