import { classifyMarkdownLink } from "./markdown-link";

interface MarkdownNode {
	type: string;
	value?: string;
	url?: string;
	children?: MarkdownNode[];
}

const TREE_BRANCH = /^[ \t│]*(?:├|└)[─━-]+[ \t]*/;

function linesOf(children: MarkdownNode[]): MarkdownNode[][] {
	const lines: MarkdownNode[][] = [[]];
	for (const node of children) {
		if (node.type === "break") {
			lines.push([]);
		} else if (node.type === "text" && node.value?.includes("\n")) {
			const parts = node.value.split("\n");
			for (let index = 0; index < parts.length; index++) {
				if (index) lines.push([]);
				if (parts[index]) lines.at(-1)!.push({ type: "text", value: parts[index] });
			}
		} else {
			lines.at(-1)!.push(node);
		}
	}
	return lines;
}

function groupTree(node: MarkdownNode): MarkdownNode[] | null {
	if (node.type !== "paragraph" || !node.children) return null;
	const allLines = linesOf(node.children);
	const start = allLines.findIndex((line) => line[0]?.type === "text" && TREE_BRANCH.test(line[0].value ?? ""));
	if (start < 0) return null;
	const leading = allLines
		.slice(0, start)
		.flatMap((nodes, index) => (index ? [{ type: "text", value: "\n" }, ...nodes] : nodes));
	const lines = allLines.slice(start);
	const items: MarkdownNode[] = [];
	let tail: MarkdownNode[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const prefix = line[0];
		if (prefix?.type !== "text" || !TREE_BRANCH.test(prefix.value ?? "")) {
			if (items.length < 2) return null;
			tail = lines
				.slice(index)
				.flatMap((nodes, offset) => (offset ? [{ type: "text", value: "\n" }, ...nodes] : nodes));
			break;
		}
		const content = [{ ...prefix, value: prefix.value!.replace(TREE_BRANCH, "") }, ...line.slice(1)].filter(
			(child) => child.type !== "text" || child.value?.trim(),
		);
		const link = content[0];
		if (link?.type !== "link" || classifyMarkdownLink(link.url).type !== "file") return null;
		items.push({ type: "listItem", children: [{ type: "paragraph", children: [link] }] });
		if (content.length > 1) {
			// Preserve the following prose and its inline formatting as a separate paragraph.
			if (index !== lines.length - 1 && !prefix.value!.includes("└")) return null;
			if (
				lines.slice(index + 1).some((nodes) => nodes[0]?.type === "text" && TREE_BRANCH.test(nodes[0].value ?? ""))
			)
				return null;
			tail = content.slice(1);
			for (const following of lines.slice(index + 1)) tail.push({ type: "text", value: "\n" }, ...following);
			break;
		}
	}
	if (items.length < 2) return null;
	return [
		...(leading.length ? [{ type: "paragraph", children: leading }] : []),
		{ type: "list", children: items },
		...(tail.length ? [{ type: "paragraph", children: tail }] : []),
	];
}

/** Only explicit tree branches of file links become artifacts; literal examples and mixed trees stay intact. */
export function remarkArtifactTrees() {
	return (root: MarkdownNode): void => {
		function visit(parent: MarkdownNode): void {
			if (!parent.children || parent.type === "link" || parent.type === "code" || parent.type === "inlineCode")
				return;
			parent.children = parent.children.flatMap((child) => {
				const grouped = groupTree(child);
				if (grouped) return grouped;
				visit(child);
				return [child];
			});
		}
		visit(root);
	};
}
