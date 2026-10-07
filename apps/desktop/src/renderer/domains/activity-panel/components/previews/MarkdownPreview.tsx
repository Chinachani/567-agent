import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import { useMarkdownHost } from "@shared/hooks/useMarkdownHost";
import { memo } from "react";
import { useMarkdownLabels } from "@shared/hooks/useMarkdownLabels";
import { useMarkdownPreviewModel } from "../../hooks/useMarkdownPreviewModel";

interface MarkdownPreviewProps {
	content: string;
}

export const MarkdownPreview = memo(function MarkdownPreview({ content }: MarkdownPreviewProps): JSX.Element {
	const model = useMarkdownPreviewModel();
	const host = useMarkdownHost(null);
	const labels = useMarkdownLabels();

	return (
		<MarkdownPreviewView content={content} theme={model.theme} onOpenExternal={model.onOpenExternal} host={host} labels={labels} />
	);
});
