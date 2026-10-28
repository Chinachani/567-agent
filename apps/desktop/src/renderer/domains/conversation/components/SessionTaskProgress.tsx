import { Button } from "@shared/components/ui/button";
import {
	TaskProgressActions,
	TaskProgressDetail,
	TaskProgressLinks,
	TaskProgressStatus,
	TaskProgressView,
} from "@vetta-org/theme-ui/chat";
import { useTranslation } from "react-i18next";
import { useTaskProgressModel } from "../hooks/useTaskProgressModel";
import { presentChatError } from "../services/error-presentation";
import { formatTurnDuration } from "./message-list/turnDuration";

export function SessionTaskProgress() {
	const { t } = useTranslation("chat");
	const model = useTaskProgressModel();
	const progress = model.progress;
	if (!progress) return null;
	if (["replyComplete", "goalComplete"].includes(progress.phase))
		return model.deliveries > 0 || progress.canContinue ? (
			<div className="w-full px-2 pb-1 sm:px-4">
				<div className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2">
					{model.deliveries > 0 ? (
						<Button variant="ghost" size="xs" onClick={model.openDeliveries}>
							<span aria-hidden className="icon-[solar--box-linear] h-3.5 w-3.5" />
							{t("taskProgress.deliveries", { count: model.deliveries })}
						</Button>
					) : null}
					{progress.canContinue ? (
						<Button variant="ghost" size="xs" className="ml-auto" disabled={model.pending} onClick={model.resume}>
							{t(model.pending ? "taskProgress.resuming" : "taskProgress.continue")}
						</Button>
					) : null}
				</div>
			</div>
		) : null;
	const errorKind = progress.error ? presentChatError(progress.error).kind : undefined;
	const cause = errorKind ? t(`messageList.errorBlock.kinds.${errorKind}.title`) : undefined;
	return (
		<TaskProgressView>
			<TaskProgressStatus
				title={t(`taskProgress.phases.${progress.phase}`)}
				elapsed={
					model.elapsedSeconds !== undefined
						? t("taskProgress.elapsed", { duration: formatTurnDuration(model.elapsedSeconds, t) })
						: undefined
				}
				running={progress.running}
				attention={["failed", "blocked", "limited"].includes(progress.phase)}
			/>
			<TaskProgressActions>
				{progress.canContinue ? (
					<Button
						variant="outline"
						size="sm"
						className="h-8 text-[12px]"
						disabled={model.pending}
						onClick={model.resume}
					>
						{t(model.pending ? "taskProgress.resuming" : "taskProgress.continue")}
					</Button>
				) : null}
			</TaskProgressActions>
			<TaskProgressDetail
				objective={model.goal?.objective}
				text={
					progress.tool?.currentPhase ||
					(progress.tool
						? t("taskProgress.tool", { name: progress.tool.toolName })
						: progress.phase === "retrying" && model.retry
							? t("taskProgress.retry", { attempt: model.retry.attempt, max: model.retry.maxAttempts })
							: `${cause ? `${cause} · ` : ""}${errorKind ? t(`messageList.errorBlock.kinds.${errorKind}.hint`) : t(`taskProgress.hints.${progress.phase}`)}`)
				}
			/>
			<TaskProgressLinks>
				{progress.error ? (
					<Button variant="ghost" size="xs" className="h-6 px-1.5 text-[11px]" onClick={model.openError}>
						{t("taskProgress.errorDetails")}
					</Button>
				) : null}
				{model.goal ? (
					<Button variant="ghost" size="xs" className="h-6 px-1.5 text-[11px]" onClick={model.openGoal}>
						{t("taskProgress.goal")}
					</Button>
				) : null}
				{model.deliveries > 0 ? (
					<Button variant="ghost" size="xs" className="h-6 px-1.5 text-[11px]" onClick={model.openDeliveries}>
						<span aria-hidden className="icon-[solar--box-linear] h-3 w-3" />
						{t("taskProgress.deliveries", { count: model.deliveries })}
					</Button>
				) : null}
			</TaskProgressLinks>
		</TaskProgressView>
	);
}
