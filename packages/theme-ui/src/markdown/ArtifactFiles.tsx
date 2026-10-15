import { Button } from "@vetta-org/ui";
import { useState } from "react";
import { classifyMarkdownLink } from "./markdown-link";
import type { HastElement } from "./nodes";
import type { MarkdownLabels } from "./rich-labels";

interface ArtifactFile { path: string; name: string }
const isElement = (node: unknown): node is HastElement =>
	!!node && typeof node === "object" && "type" in node && node.type === "element" && "children" in node && Array.isArray(node.children);

/** Only file-only list items qualify. Explanations, tasks, images and nested lists stay Markdown. */
export function artifactFiles(node: unknown): ArtifactFile[] | null {
	if (!isElement(node)) return null;
	const files: ArtifactFile[] = [];
	for (const item of node.children) {
		if (item.type === "text" && !item.value.trim()) continue;
		if (!isElement(item) || item.tagName !== "li") return null;
		const children = item.children.filter((child) => child.type !== "text" || child.value.trim());
		const content = children.length === 1 && isElement(children[0]) && children[0].tagName === "p"
			? children[0].children.filter((child) => child.type !== "text" || child.value.trim()) : children;
		if (content.length !== 1 || !isElement(content[0]) || content[0].tagName !== "a") return null;
		const link = classifyMarkdownLink(String(content[0].properties?.href ?? ""));
		if (link.type !== "file") return null;
		files.push({ path: link.path, name: link.path.replace(/\\/g, "/").split("/").pop() || link.path });
	}
	return files.length > 0 ? files : null;
}

export function ArtifactFiles({ files, labels, icon, open }: {
	files: ArtifactFile[];
	labels: MarkdownLabels;
	icon: (fileName: string) => string;
	open: (path: string) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const collapsible = files.length > 3;
	const visible = !collapsible || expanded;
	const title = labels.artifacts?.title ?? "Artifacts";
	const count = labels.artifacts?.count(files.length) ?? `${files.length} files`;
	const types = new Map<string, number>();
	for (const file of files) {
		const extension = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() || "…" : "…";
		types.set(extension, (types.get(extension) ?? 0) + 1);
	}
	return <div className={collapsible ? "my-2 rounded-xl border border-border/50 bg-card/40" : "my-2"}>
		{collapsible && <Button variant="ghost" type="button" aria-expanded={visible}
			onClick={() => setExpanded((value) => !value)} className="h-auto min-h-9 w-full justify-start gap-2 px-3 py-2 text-[13px]">
			<span className="icon-[solar--folder-open-linear] h-4 w-4 shrink-0" />
			<span>{title} · {count}</span>
			<span className="truncate text-[11px] font-normal text-muted-foreground">{[...types].map(([type, n]) => `${type} × ${n}`).join(" · ")}</span>
			<span className={`${visible ? "icon-[solar--alt-arrow-up-linear]" : "icon-[solar--alt-arrow-down-linear]"} ml-auto h-3.5 w-3.5 shrink-0`} />
		</Button>}
		{visible && <div className={collapsible ? "grid max-h-56 grid-cols-[repeat(auto-fit,minmax(min(240px,100%),1fr))] gap-1 overflow-y-auto p-2" : "flex flex-wrap gap-1.5"}>
			{files.map((file, index) => <Button key={`${index}-${file.path}`} type="button" variant="ghost"
				onClick={() => open(file.path)} title={file.path} className="h-auto min-h-8 min-w-0 max-w-full justify-start gap-1.5 px-2 py-1 text-[13px]">
				<span className={`${icon(file.name)} h-3.5 w-3.5 shrink-0`} />
				<span className="min-w-0 break-all text-left font-normal">{file.name}</span>
			</Button>)}
		</div>}
	</div>;
}
