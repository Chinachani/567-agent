import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import {
	activeSessionAtom,
	activityPanelOpenAtom,
	activityPanelTabByProjectAtom,
	chatMessagesAtom,
	confirmDialogAtom,
	conversationDeliveriesAtom,
	floatingActivityTabsByProjectAtom,
	goalDialogOpenAtom,
	goalStateBySessionAtom,
	hiddenActivityTabsAtom,
	isCompactingAtom,
	isConversationBusyAtom,
	isReloadingMcpAtom,
	pendingMcpElicitationsAtom,
	pendingPlanReviewsAtom,
	pendingQuestionsAtom,
	pendingScrollToEntryAtom,
	pendingSessionSendAtom,
	retryProgressAtom,
	sandboxPermissionDrawerAtom,
} from "@shared/store/atoms";
import { messageQueueBySessionAtom, messageQueuePausedBySessionAtom } from "@shared/store/message-queue-atoms";
import { showToast } from "@shared/store/toast-atoms";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { lastConversationMessage, projectTaskProgress } from "../services/task-progress";

export function useTaskProgressModel() {
	const { t } = useTranslation("chat");
	const store = useStore();
	const session = useAtomValue(activeSessionAtom);
	const messages = useAtomValue(chatMessagesAtom);
	const busy = useAtomValue(isConversationBusyAtom);
	const compacting = useAtomValue(isCompactingAtom);
	const connecting = useAtomValue(isReloadingMcpAtom);
	const retry = useAtomValue(retryProgressAtom);
	const preparing = useAtomValue(pendingSessionSendAtom) !== null;
	const questions = useAtomValue(pendingQuestionsAtom);
	const elicitations = useAtomValue(pendingMcpElicitationsAtom);
	const approvals = useAtomValue(pendingPlanReviewsAtom);
	const permission = useAtomValue(sandboxPermissionDrawerAtom);
	const goals = useAtomValue(goalStateBySessionAtom);
	const pausedQueues = useAtomValue(messageQueuePausedBySessionAtom);
	const queues = useAtomValue(messageQueueBySessionAtom);
	const deliveries = useAtomValue(conversationDeliveriesAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const setGoalOpen = useSetAtom(goalDialogOpenAtom);
	const [pendingRuntimes, setPendingRuntimes] = useState<ReadonlySet<string>>(new Set());
	const inFlight = useRef(new Set<string>());
	const runtimeId = session?.runtimeId;
	const goal = runtimeId ? goals[runtimeId] : undefined;
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		if (!busy || !runtimeId) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [busy, runtimeId]);
	const latest = lastConversationMessage(messages);
	const elapsedSeconds =
		busy && latest?.kind === "agent" && latest.startedAt !== undefined
			? Math.max(0, Math.floor((now - latest.startedAt) / 1000))
			: undefined;
	const progress = projectTaskProgress({
		messages,
		busy,
		preparing,
		compacting,
		connecting,
		retry,
		goal,
		question: Boolean(runtimeId && (questions[runtimeId] || elicitations[runtimeId])),
		approval: Boolean(runtimeId && approvals[runtimeId]),
		permission: Boolean(runtimeId && permission?.runtimeId === runtimeId),
		queuePaused: Boolean(runtimeId && pausedQueues.get(runtimeId) && queues.get(runtimeId)?.length),
	});
	const resume = useCallback(() => {
		if (!session || !progress?.canContinue || inFlight.current.has(session.runtimeId)) return;
		const tail = lastConversationMessage(messages);
		const target = {
			runtimeId: session.runtimeId,
			messageId: tail?.id,
			phase: tail?.kind === "agent" ? tail.phase : undefined,
			goalId: goal?.goalId,
			goalStatus: goal?.status,
		};
		setConfirm({
			title: t("taskProgress.recoveryTitle"),
			message: t("taskProgress.recoveryBody"),
			confirmLabel: t("taskProgress.confirmContinue"),
			cancelLabel: t("taskProgress.cancel"),
			onConfirm: () => {
				if (inFlight.current.has(target.runtimeId)) return;
				const valid = (): boolean => {
					const latest = lastConversationMessage(store.get(chatMessagesAtom));
					return (
						store.get(activeSessionAtom)?.runtimeId === target.runtimeId &&
						!store.get(isConversationBusyAtom) &&
						!store.get(pendingQuestionsAtom)[target.runtimeId] &&
						!store.get(pendingMcpElicitationsAtom)[target.runtimeId] &&
						!store.get(pendingPlanReviewsAtom)[target.runtimeId] &&
						store.get(sandboxPermissionDrawerAtom)?.runtimeId !== target.runtimeId &&
						!(
							store.get(messageQueuePausedBySessionAtom).get(target.runtimeId) &&
							store.get(messageQueueBySessionAtom).get(target.runtimeId)?.length
						) &&
						latest?.id === target.messageId &&
						latest?.kind === "agent" &&
						latest.phase === target.phase &&
						store.get(goalStateBySessionAtom)[target.runtimeId]?.goalId === target.goalId &&
						store.get(goalStateBySessionAtom)[target.runtimeId]?.status === target.goalStatus &&
						!latest.blocks.some(
							(block) => block.type === "error" && block.details?.code?.toLowerCase() === "turn_persistence",
						)
					);
				};
				if (!valid()) {
					showToast({ variant: "info", message: t("taskProgress.changed") });
					return;
				}
				inFlight.current.add(target.runtimeId);
				setPendingRuntimes((previous) => new Set(previous).add(target.runtimeId));
				void (async () => {
					await waitForCommittedPaint();
					if (!valid()) {
						showToast({ variant: "info", message: t("taskProgress.changed") });
						return;
					}
					const currentGoal = store.get(goalStateBySessionAtom)[target.runtimeId];
					if (currentGoal && ["paused", "blocked", "usage_limited"].includes(currentGoal.status))
						await window.agent567.session.resumeGoal(target.runtimeId, currentGoal.goalId);
					else await window.agent567.session.continue(target.runtimeId);
				})()
					.catch(() => {
						if (store.get(activeSessionAtom)?.runtimeId === target.runtimeId)
							showToast({ variant: "error", message: t("taskProgress.recoveryFailed") });
					})
					.finally(() => {
						inFlight.current.delete(target.runtimeId);
						setPendingRuntimes((previous) => {
							const next = new Set(previous);
							next.delete(target.runtimeId);
							return next;
						});
					});
			},
		});
	}, [session, progress?.canContinue, messages, goal?.goalId, goal?.status, setConfirm, store, t]);
	const openDeliveries = useCallback(() => {
		if (!session) return;
		const hidden = store.get(hiddenActivityTabsAtom);
		store.set(
			hiddenActivityTabsAtom,
			new Map(hidden).set(
				session.cwd,
				(hidden.get(session.cwd) ?? []).filter((key) => key !== "deliveries"),
			),
		);
		store.set(floatingActivityTabsByProjectAtom, (previous) =>
			new Map(previous).set(
				session.cwd,
				(previous.get(session.cwd) ?? []).filter((item) => item.key !== "deliveries"),
			),
		);
		store.set(activityPanelTabByProjectAtom, (previous) => new Map(previous).set(session.cwd, "deliveries"));
		store.set(activityPanelOpenAtom, true);
	}, [session, store]);
	const openError = useCallback(() => {
		if (latest) store.set(pendingScrollToEntryAtom, { entryId: latest.renderKey ?? latest.entryId ?? latest.id });
	}, [latest, store]);
	return {
		progress,
		elapsedSeconds,
		goal,
		retry,
		deliveries: deliveries.length,
		pending: Boolean(runtimeId && pendingRuntimes.has(runtimeId)),
		resume,
		openDeliveries,
		openError,
		openGoal: () => setGoalOpen(true),
	};
}
