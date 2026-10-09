import { MarkdownPreviewView } from "@vetta-org/theme-ui/activity";
import { useMarkdownHost } from "@shared/hooks/useMarkdownHost";
import { useMarkdownLabels } from "@shared/hooks/useMarkdownLabels";
import { resolvedThemeAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { useCallback } from "react";

/** 长说明按正文排，不装箱，避免和封面/对照台抢同一套卡片语言。 */
export function AbilityMarkdownBody({ content }: { content: string }): JSX.Element | null {
	const theme = useAtomValue(resolvedThemeAtom);
	const host = useMarkdownHost(null);
	const labels = useMarkdownLabels();
	const onOpenExternal = useCallback((href: string) => {
		void window.agent567.shell.openExternal(href);
	}, []);

	if (!content.trim()) return null;

	return (
		<section className="text-[13px] leading-relaxed [&_.markdown-body]:p-0">
			<MarkdownPreviewView content={content} theme={theme} onOpenExternal={onOpenExternal} host={host} labels={labels} />
		</section>
	);
}
