interface MarkdownNode {
	type: string;
	value?: string;
	url?: string;
	children?: MarkdownNode[];
	position?: { start: { offset?: number }; end: { offset?: number } };
}

function recoverTarget(value: string): string | null {
	if (value.length > 8192) return null;
	const match = /^(https?:\/\/\S+?)(?:\]|%5[Dd])\(\1\)$/.exec(value.trim());
	if (!match) return null;
	try {
		const url = new URL(match[1]);
		return !url.username && !url.password ? match[1] : null;
	} catch {
		return null;
	}
}

/** GFM can consume a broken [label](target) as one encoded URL or two autolinks. */
export function remarkResourceLinks() {
	return (root: MarkdownNode, file: { value: unknown }): void => {
		const source = String(file.value);
		function raw(node: MarkdownNode): string {
			const start = node.position?.start.offset;
			const end = node.position?.end.offset;
			return start === undefined || end === undefined ? "" : source.slice(start, end);
		}
		function visit(parent: MarkdownNode): void {
			if (!parent.children || parent.type === "code" || parent.type === "inlineCode") return;
			for (let index = 0; index < parent.children.length; index++) {
				const node = parent.children[index];
				const target = node.type === "paragraph" ? recoverTarget(raw(node)) : null;
				if (target) {
					node.children = [{ type: "link", url: target, children: [{ type: "text", value: target }] }];
					const previous = parent.children[index - 1];
					const last = previous?.type === "paragraph" ? previous.children?.at(-1) : null;
					if (last?.type === "text") last.value = last.value?.replace(/\[\s*$/, "");
					continue;
				}
				if (node.type === "link") {
					// An explicit Markdown destination may legitimately contain brackets.
					const recovered = raw(node).startsWith("http") ? recoverTarget(node.url ?? "") : null;
					if (recovered) {
						node.url = recovered;
						node.children = [{ type: "text", value: recovered }];
					}
				} else {
					visit(node);
				}
			}
		}
		visit(root);
	};
}
