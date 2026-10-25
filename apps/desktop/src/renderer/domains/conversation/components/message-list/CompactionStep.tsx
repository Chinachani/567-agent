import { CompactionBoundaryView } from "@vetta-org/theme-ui/chat";
import { useTranslation } from "react-i18next";

export function CompactionStep({
	status,
	errorMessage,
}: {
	status: "running" | "completed" | "failed";
	errorMessage?: string;
}) {
	const { t } = useTranslation("chat");
	return (
		<div>
			<CompactionBoundaryView label={t(`messageList.compactionStep.${status}`)} />
			{status === "failed" && errorMessage && (
				<p role="alert" className="break-words px-3 text-[11px] text-destructive">
					{errorMessage}
				</p>
			)}
		</div>
	);
}
