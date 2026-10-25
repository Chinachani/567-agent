import { readImageDimensions } from "../image-cache/image-cache-service.js";

/** Raster-only, bounded previews. Never render SVG/HTML or follow image URLs. */
export async function attachmentThumbnail(bytes: Buffer): Promise<string | undefined> {
	const mime = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"].find(
		(type) => readImageDimensions(bytes, type) !== undefined,
	);
	if (!mime) return;
	const dimensions = readImageDimensions(bytes, mime);
	if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > 8_000_000)
		return;
	// Load the native decoder only when a visible image row asks for a preview.
	const { nativeImage } = await import("electron");
	const original = nativeImage.createFromBuffer(bytes);
	if (original.isEmpty()) return;
	const ratio = Math.min(1, 256 / Math.max(dimensions.width, dimensions.height));
	const preview = original.resize({
		width: Math.max(1, Math.round(dimensions.width * ratio)),
		height: Math.max(1, Math.round(dimensions.height * ratio)),
	});
	const png = preview.toPNG();
	if (png.length <= 48 * 1024) return `data:image/png;base64,${png.toString("base64")}`;
	const jpeg = preview.toJPEG(70);
	if (jpeg.length <= 48 * 1024) return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}
