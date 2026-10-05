export interface UnreviewedMcpPromptValues {
	name: string;
	description: string;
	author: string;
	version: string;
	license: string;
	documentation: string;
	repositoryLabel: string;
	repository: string;
}

/** Keep third-party metadata on one line so it cannot escape the prompt's metadata section. */
export function sanitizeUnreviewedMcpPromptValue(value: string): string {
	return value
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/[\r\n]+/g, " ")
		.replace(/`/g, "'")
		.replace(/\|/g, "\\|")
		.trim();
}

/** Only use documentation metadata from this MCP entry; catalog/source repositories are not project URLs. */
export function getUnreviewedMcpDocumentationUrl(
	meta: Array<{ key?: string; label?: string; value: string }> | undefined,
): string {
	const entry = meta?.find((item) => {
		if (item.key === "docs") return true;
		const label = item.label?.trim().toLocaleLowerCase();
		return label === "文档" || label === "使用说明" || label === "documentation" || label === "docs";
	});
	const value = entry?.value.trim();
	if (!value) return "";
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
	} catch {
		return "";
	}
}

/** Use an MCP-declared repository when present; catalog URLs remain clearly labeled fallbacks. */
export function getUnreviewedMcpRepositoryUrl(
	meta: Array<{ key?: string; label?: string; value: string }> | undefined,
): string {
	const entry = meta?.find((item) => {
		if (item.key === "repository") return true;
		const label = item.label?.trim().toLocaleLowerCase();
		return ["仓库", "项目仓库", "源代码", "source code", "repository", "repo"].includes(label ?? "");
	});
	const value = entry?.value.trim();
	if (!value) return "";
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
	} catch {
		return "";
	}
}

export function interpolateUnreviewedMcpPrompt(template: string, values: UnreviewedMcpPromptValues): string {
	return template.replace(
		/\{\{(name|description|author|version|license|documentation|repositoryLabel|repository)\}\}/g,
		(_match, key: keyof UnreviewedMcpPromptValues) => sanitizeUnreviewedMcpPromptValue(values[key]),
	);
}
