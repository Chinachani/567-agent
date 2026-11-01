import { i18n } from "@shared/i18n";
import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { resolveLocalFilePath } from "@shared/lib/resolve-local-file-path";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	filePreviewAtom,
	mountedActivityWorkspacesAtom,
	openInlineFilePreviewAtom,
} from "@shared/store/atoms";
import { showToast } from "@shared/store/toast-atoms";
import type { MarkdownHost } from "@vetta-org/theme-ui/markdown";
import { useSetAtom, useStore } from "jotai";
import { useMemo } from "react";
import { imageAsPng, imageDataForAction, imageFileName, resolveMarkdownImage } from "../lib/markdown-images";

export function useMarkdownHost(baseDirectory: string | null): MarkdownHost {
	const store = useStore();
	const open = useSetAtom(filePreviewAtom);
	const preview = useSetAtom(openInlineFilePreviewAtom);
	const setPanelOpen = useSetAtom(activityPanelOpenAtom);
	return useMemo(
		() => ({
			async openExternalUrl(url) {
				await window.agent567.shell.openExternal(url);
			},
			async copyText(value, kind) {
				await navigator.clipboard.writeText(kind === "file" ? resolveLocalFilePath(value, baseDirectory) : value);
				showToast({ variant: "success", message: i18n.t("chat:copyButton.copied"), durationMs: 1500 });
			},
			async revealFile(path) {
				await window.agent567.shell.showItemInFolder(resolveLocalFilePath(path, baseDirectory));
			},
			previewCode(code, language) {
				const mounted = store.get(mountedActivityWorkspacesAtom);
				const activeCwd = store.get(activeSessionAtom)?.cwd;
				const owner =
					mounted.find((workspace) => workspace.cwd === baseDirectory) ??
					mounted.find((workspace) => workspace.cwd === activeCwd) ??
					(mounted.length === 1 ? mounted[0] : undefined);
				const workspaceId = owner?.id ?? activeCwd ?? baseDirectory;
				if (workspaceId)
					store.set(activityPanelTabByProjectAtom, (previous) => new Map(previous).set(workspaceId, "file"));
				setPanelOpen(true);
				preview({ name: codeFileName(language), text: code, kind: "file" });
			},
			async saveCode(code, language) {
				await window.agent567.dialog.saveData(codeFileName(language), code, "utf8");
			},
			async openHtml(source) {
				await waitForCommittedPaint();
				const id = await window.agent567.markdown.openHtml(source);
				return () => {
					void window.agent567.markdown.closeHtml(id).catch(() => {});
				};
			},
			renderMermaid: async (source, theme) => window.agent567.markdown.renderMermaid(source, theme),
			favicon: async (origin) => window.agent567.markdown.favicon(origin),
			async resolveImage(source) {
				return resolveMarkdownImage(source, baseDirectory, async (path) => {
					const resolved = resolveLocalFilePath(path, baseDirectory);
					if (!baseDirectory) throw new Error("Image has no document directory");
					return window.agent567.fs.readFile(resolved);
				});
			},
			async copyImage(source) {
				await window.agent567.clipboard.writeImage(await imageAsPng(await imageDataForAction(source)));
			},
			async saveImage(source) {
				const data = await imageDataForAction(source);
				const comma = data.indexOf(",");
				const base64 = data.slice(0, comma).includes(";base64");
				await window.agent567.dialog.saveData(
					imageFileName(data),
					base64 ? data.slice(comma + 1) : decodeURIComponent(data.slice(comma + 1)),
					base64 ? "base64" : "utf8",
				);
			},
			openImage: (url, name) =>
				open({ name: `${name || "image"}.${imageFileName(url).split(".").pop()}`, url, kind: "image" }),
		}),
		[baseDirectory, open, preview, setPanelOpen, store],
	);
}

function codeFileName(language: string): string {
	const extensions: Record<string, string> = {
		javascript: "js",
		typescript: "ts",
		python: "py",
		shell: "sh",
		bash: "sh",
		rust: "rs",
		csharp: "cs",
		cpp: "cpp",
		kotlin: "kt",
		markdown: "md",
		plaintext: "txt",
	};
	const normalized = language.toLowerCase();
	return `code.${extensions[normalized] ?? (/^[a-z0-9]{1,12}$/.test(normalized) ? normalized : "txt")}`;
}
