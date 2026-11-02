import { i18n } from "@shared/i18n";
import { showToast } from "@shared/store/toast-atoms";
import type { FilePreviewItem } from "@vetta-org/theme-ui/file-preview";
import { getExtension } from "@vetta-org/theme-ui/file-preview";

const TEXT_EXTENSIONS = new Set([
	"md",
	"mdx",
	"markdown",
	"ts",
	"tsx",
	"mts",
	"cts",
	"js",
	"jsx",
	"mjs",
	"cjs",
	"json",
	"jsonc",
	"json5",
	"yaml",
	"yml",
	"toml",
	"xml",
	"xsd",
	"xsl",
	"xslt",
	"plist",
	"html",
	"htm",
	"xhtml",
	"vue",
	"svelte",
	"astro",
	"css",
	"scss",
	"less",
	"py",
	"pyi",
	"pyw",
	"go",
	"rs",
	"java",
	"kt",
	"kts",
	"swift",
	"rb",
	"php",
	"c",
	"cpp",
	"cc",
	"cxx",
	"h",
	"hpp",
	"hh",
	"cs",
	"sh",
	"bash",
	"zsh",
	"fish",
	"sql",
	"graphql",
	"gql",
	"lua",
	"r",
	"dart",
	"env",
	"lock",
	"ini",
	"cfg",
	"conf",
	"properties",
	"log",
	"txt",
	"dockerfile",
	"makefile",
	"mk",
]);

const SUPPORTED_EXTENSIONS = new Set<string>([...TEXT_EXTENSIONS]);

export function isPreviewSupported(name: string): boolean {
	return SUPPORTED_EXTENSIONS.has(getExtension(name));
}

export function isTextExtension(ext: string): boolean {
	return TEXT_EXTENSIONS.has(ext);
}

export async function downloadItem(item: FilePreviewItem): Promise<void> {
	try {
		await savePreviewItem(item);
	} catch {
		showToast({ variant: "error", message: i18n.t("chat:fileEditor.errorDownload") });
	}
}

async function savePreviewItem(item: FilePreviewItem): Promise<void> {
	if (item.text !== undefined) {
		await window.agent567.dialog.saveData(item.name, item.text, "utf8");
		return;
	}
	if (item.path) {
		await window.agent567.dialog.saveCopy(item.path, { defaultFileName: item.name });
		return;
	}
	if (!item.url) return;
	const response = await fetch(item.url);
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const blob = await response.blob();
	const objectUrl = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = objectUrl;
	anchor.download = item.name;
	document.body.append(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(objectUrl);
}
