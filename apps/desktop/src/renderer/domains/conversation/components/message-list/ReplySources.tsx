import type { TextSource } from "@567agent/ai/protocol";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

export function ReplySources({ sources }: { sources: readonly TextSource[] }) {
	const { t } = useTranslation("chat");
	const id = useId();
	const [open, setOpen] = useState(false);
	const [failedUrl, setFailedUrl] = useState("");
	return (
		<div className="mt-2 text-xs">
			<button
				type="button"
				aria-expanded={open}
				aria-controls={id}
				onClick={() => setOpen(!open)}
				className="rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
			>
				{t("messageList.replySources.count", { count: sources.length })}
			</button>
			{open ? (
				<ol id={id} className="space-y-1 py-1">
					{sources.map((source, index) => (
						<li key={source.url}>
							<button
								type="button"
								className="max-w-full rounded px-2 py-1 text-left hover:bg-accent"
								title={source.url}
								onClick={() => {
									setFailedUrl("");
									void window.agent567.shell.openExternal(source.url).catch(() => setFailedUrl(source.url));
								}}
							>
								<span className="block break-words">
									{index + 1}. {source.title || source.url}
								</span>
								{source.title ? (
									<span className="block break-all text-muted-foreground">{source.url}</span>
								) : null}
							</button>
							{failedUrl === source.url ? (
								<span role="status">{t("messageList.replySources.failed")}</span>
							) : null}
						</li>
					))}
				</ol>
			) : null}
		</div>
	);
}
