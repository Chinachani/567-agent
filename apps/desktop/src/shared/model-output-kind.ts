import { getModelContextReference } from "./model-context-reference.js";

interface ModelOutputMetadata {
	readonly output?: readonly string[];
	readonly tags?: readonly string[];
}

export type ModelOutputKind = "image-only" | "text-and-image" | "other" | "unknown";

const IMAGE_TAGS = new Set(["image-generation", "image-gen"]);
const IMAGE_FAMILY =
	/^(?:(?:gpt|chatgpt)-image|dall-e|dalle|flux|sdxl|stable-diffusion|imagen|ideogram|recraft|midjourney|(?:doubao-)?seedream|nano[-_]banana|qwen-image|agnes)(?:[-_.]|$)/;
const NON_IMAGE_OUTPUT = /(?:^|[-_])(?:ocr|vision|embedding|video|caption|image-to-text)(?:[-_.]|$)/;

export function modelOutputKind(id: string, metadata?: ModelOutputMetadata): ModelOutputKind {
	const key = (id.split("/").at(-1) ?? id).toLowerCase();
	const tags = metadata?.tags?.map((tag) => tag.toLowerCase()) ?? [];
	if (tags.includes("image-generation-only")) return "image-only";
	const explicit = metadata?.output?.map((value) => value.toLowerCase()) ?? [];
	if (explicit.length > 0) {
		return explicit.includes("image") ? (explicit.includes("text") ? "text-and-image" : "image-only") : "other";
	}
	if (NON_IMAGE_OUTPUT.test(key)) return "other";
	if (tags.some((tag) => IMAGE_TAGS.has(tag))) return "image-only";
	// These API families commonly return textual status or captions alongside images.
	// That does not make their generation endpoints valid ordinary chat models.
	if (IMAGE_FAMILY.test(key) || (key.startsWith("gemini-") && key.split("-").includes("image"))) {
		return "image-only";
	}
	const catalog = (getModelContextReference(id) ?? getModelContextReference(key))?.capabilities?.output;
	if (!catalog?.length) return key.includes("text-to-image") ? "image-only" : "unknown";
	return catalog.includes("image") ? (catalog.includes("text") ? "text-and-image" : "image-only") : "other";
}
