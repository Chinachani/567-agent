import type { MarkdownLabels } from "@vetta-org/theme-ui/markdown";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function useMarkdownLabels(): MarkdownLabels {
	const { t } = useTranslation("chat");
	return useMemo(
		() => ({
			copy: t("copyButton.label"),
			resources: {
				openFile: t("markdown.resourceMenu.openFile"),
				openUrl: t("markdown.resourceMenu.openUrl"),
				copyFile: t("markdown.resourceMenu.copyFile"),
				copyUrl: t("markdown.resourceMenu.copyUrl"),
				revealFile: t("markdown.resourceMenu.revealFile"),
				failed: t("markdown.actionFailed"),
			},
			artifacts: {
				title: t("markdown.artifacts"),
				count: (count: number) => t("markdown.artifactCount", { count }),
			},
			copied: t("copyButton.copied"),
			rich: {
				preview: t("markdown.preview"),
				source: t("markdown.source"),
				run: t("markdown.run"),
				stop: t("markdown.stop"),
				waiting: t("markdown.waiting"),
				paused: t("markdown.paused"),
				tooLarge: t("markdown.tooLarge"),
				failed: t("markdown.failed"),
				staticHtml: t("markdown.staticHtml"),
				running: t("markdown.running"),
				svg: t("markdown.svg"),
				html: t("markdown.html"),
				loading: t("markdown.loading"),
				retry: t("markdown.retry"),
				enlarge: t("markdown.enlarge"),
				save: t("markdown.save"),
				diagram: t("markdown.diagram"),
				imageFailed: t("markdown.imageFailed"),
				actionFailed: t("markdown.actionFailed"),
			},
		}),
		[t],
	);
}
