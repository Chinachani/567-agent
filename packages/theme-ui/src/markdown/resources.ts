import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { classifyMarkdownLink, normalizeLocalFileLinksInMarkdown } from "./markdown-link";
import { remarkResourceLinks } from "./resource-links";

export interface MarkdownResource {
	readonly kind: "file" | "url" | "image";
	readonly target: string;
	readonly label: string;
}

interface ResourceNode {
	readonly type: string;
	readonly url?: string;
	readonly identifier?: string;
	readonly alt?: string | null;
	readonly value?: string;
	readonly children?: readonly ResourceNode[];
}

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkResourceLinks);
function plainText(node: ResourceNode): string {
	return node.value ?? node.children?.map(plainText).join("") ?? "";
}

/** Uses the same Markdown parser, URL repair and link classification as the message view. */
export function collectMarkdownResources(text: string): readonly MarkdownResource[] {
	const tree = parser.runSync(parser.parse(normalizeLocalFileLinksInMarkdown(text)));
	const definitions = new Map<string, string>();
	const resources: MarkdownResource[] = [];
	const seen = new Set<string>();
	function visit(node: ResourceNode, collect: boolean): void {
		if (node.type === "code" || node.type === "inlineCode") return;
		if (!collect && node.type === "definition" && node.identifier && node.url)
			definitions.set(node.identifier.toLowerCase(), node.url);
		if (collect && ["link", "image", "linkReference", "imageReference"].includes(node.type)) {
			const url = node.url ?? definitions.get(node.identifier?.toLowerCase() ?? "");
			const link = url ? classifyMarkdownLink(url) : null;
			if (link && link.type !== "other") {
				const target = link.type === "file" ? link.path : link.url;
				let valid = link.type === "file";
				if (link.type === "url") {
					try {
						const parsed = new URL(target);
						valid = ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
					} catch {
						valid = false;
					}
				}
				const kind = node.type.startsWith("image") ? "image" : link.type;
				const key = `${kind}:${target}`;
				if (valid && !seen.has(key)) {
					seen.add(key);
					resources.push({ kind, target, label: node.alt || plainText(node).trim() || target });
				}
			}
		}
		for (const child of node.children ?? []) visit(child, collect);
	}
	visit(tree, false);
	visit(tree, true);
	return resources;
}
