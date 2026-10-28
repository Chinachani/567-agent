import { resolveLocalFilePath } from "@shared/lib/resolve-local-file-path";
import type { ChatConversationItem } from "@shared/store/atoms";
import { collectMarkdownResources } from "@vetta-org/theme-ui/markdown";
import { conversationItemRenderKey } from "./item-key";

export interface ConversationDelivery {
	readonly id: string;
	readonly kind: "file" | "url" | "image";
	readonly target: string;
	readonly label: string;
	readonly messageId: string;
	readonly turnId: string;
	/** A tool result is evidence of a write, never proof that a file or website still works. */
	readonly evidence: "reference" | "written";
}

const resourceCache = new WeakMap<object, ReturnType<typeof collectMarkdownResources>>();

export function collectConversationDeliveries(
	messages: readonly ChatConversationItem[],
	cwd: string | null,
): readonly ConversationDelivery[] {
	const items = new Map<string, ConversationDelivery>();
	for (const message of messages) {
		if (message.kind !== "agent") continue;
		const add = (
			kind: ConversationDelivery["kind"],
			target: string,
			label: string,
			evidence: ConversationDelivery["evidence"],
		): void => {
			if (!target.trim()) return;
			const remote = /^https?:\/\//i.test(target);
			if (remote) {
				try {
					const url = new URL(target);
					if (url.username || url.password) return;
				} catch {
					return;
				}
			} else if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^[a-z]:[\\/]/i.test(target)) return;
			const resolved = /^https?:\/\//i.test(target) ? target : resolveLocalFilePath(target, cwd);
			const resourceKind =
				kind === "file" && /\.(?:png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(resolved) ? "image" : kind;
			const id = `${resourceKind}:${resolved}`;
			const previous = items.get(id);
			const source =
				evidence === "reference" && previous?.evidence === "written"
					? previous
					: { messageId: conversationItemRenderKey(message), turnId: message.turnId };
			items.set(id, {
				id,
				kind: resourceKind,
				target: resolved,
				label,
				messageId: source.messageId,
				turnId: source.turnId,
				evidence: evidence === "written" || previous?.evidence === "written" ? "written" : "reference",
			});
		};
		for (const block of message.blocks) {
			if (block.type === "text" && !["pending", "streaming"].includes(message.phase)) {
				let resources = resourceCache.get(block);
				if (!resources) {
					resources = collectMarkdownResources(block.text);
					resourceCache.set(block, resources);
				}
				for (const resource of resources) add(resource.kind, resource.target, resource.label, "reference");
			}
			if (block.type !== "tool_call" || block.status !== "success" || block.isError) continue;
			const path = block.uiDetails?.writtenPath;
			if (typeof path === "string") add("file", path, path.replace(/\\/g, "/").split("/").pop() || path, "written");
			for (const image of [...(block.imagePreviews ?? []), ...(block.imagePreview ? [block.imagePreview] : [])]) {
				if (image.originalPath)
					add(
						"image",
						image.originalPath,
						image.originalPath.replace(/\\/g, "/").split("/").pop() || image.originalPath,
						path === image.originalPath ? "written" : "reference",
					);
			}
		}
	}
	return [...items.values()];
}
