import { waitForCommittedPaint } from "@shared/lib/committed-paint";
import { confirmDialogAtom, openSessionFnRef, sessionsMapAtom } from "@shared/store/atoms";
import type {
	ProjectCollaborationCandidateView,
	ProjectCollaborationMemberView,
	ProjectCollaborationTaskView,
	ProjectCollaborationViewLabels,
	ProjectCollaborationViewProps,
} from "@vetta-org/theme-ui/project";
import type { TFunction } from "i18next";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
	ProjectCollaborationCandidate,
	ProjectCollaborationConfig,
	ProjectCollaborationMember,
	ProjectCollaborationSnapshot,
	ProjectCollaborationTask,
} from "@/shared/project-collaboration";

type ProjectCollaborationViewModel = ProjectCollaborationViewProps;
type ProjectOperation = { cwd: string; generation: number };

function operationIsCurrent(operation: ProjectOperation | null, cwd: string, generation: number): boolean {
	return operation?.cwd === cwd && operation.generation === generation;
}

function sameConfig(left: ProjectCollaborationConfig, right: ProjectCollaborationConfig): boolean {
	return (
		left.enabled === right.enabled &&
		left.paused === right.paused &&
		left.coordinatorSessionId === right.coordinatorSessionId &&
		left.members.length === right.members.length &&
		left.members.every((member, index) => {
			const other = right.members[index];
			return (
				member.sessionId === other?.sessionId &&
				member.responsibility === other.responsibility &&
				member.access === other.access
			);
		})
	);
}

function formatUpdatedAt(timestamp: number, locale: string): string {
	return new Date(timestamp).toLocaleString(locale, {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function candidateName(candidate: ProjectCollaborationCandidate | undefined, sessionId: string): string {
	return candidate?.title || sessionId.split(/[\\/]/).filter(Boolean).at(-1) || sessionId;
}

function createLabels(t: TFunction<"project">): ProjectCollaborationViewLabels {
	return {
		title: t("collaboration.title"),
		enabled: t("collaboration.enabled"),
		paused: t("collaboration.paused"),
		stopped: t("collaboration.stopped"),
		memberCount: t("collaboration.memberCount"),
		runningTasks: t("collaboration.runningTasks"),
		coordinator: t("collaboration.coordinator"),
		coordinatorBadge: t("collaboration.coordinatorBadge"),
		noCoordinator: t("collaboration.noCoordinator"),
		members: t("collaboration.members"),
		candidates: t("collaboration.candidates"),
		search: t("collaboration.search"),
		add: t("collaboration.add"),
		remove: t("collaboration.remove"),
		responsibility: t("collaboration.responsibility"),
		responsibilityPlaceholder: t("collaboration.responsibilityPlaceholder"),
		access: t("collaboration.access"),
		read: t("collaboration.read"),
		write: t("collaboration.write"),
		model: t("collaboration.model"),
		state: t("collaboration.memberState"),
		openSession: t("collaboration.openSession"),
		noMembers: t("collaboration.noMembers"),
		noCandidates: t("collaboration.noCandidates"),
		noCandidatesMatch: t("collaboration.noCandidatesMatch"),
		emptyTitle: t("collaboration.emptyTitle"),
		emptyDescription: t("collaboration.emptyDescription"),
		exampleOne: t("collaboration.exampleOne"),
		exampleTwo: t("collaboration.exampleTwo"),
		tasks: t("collaboration.tasks"),
		noTasks: t("collaboration.noTasks"),
		taskSource: t("collaboration.taskSource"),
		taskTarget: t("collaboration.taskTarget"),
		showResult: t("collaboration.showResult"),
		hideResult: t("collaboration.hideResult"),
		openSource: t("collaboration.openSource"),
		openTarget: t("collaboration.openTarget"),
		pause: t("collaboration.pause"),
		resume: t("collaboration.resume"),
		stop: t("collaboration.stop"),
		stopConfirm: t("collaboration.stopConfirm"),
		stopConfirmMessage: t("collaboration.stopConfirmMessage"),
		stopTaskConfirmMessage: t("collaboration.stopTaskConfirmMessage"),
		cancel: t("collaboration.cancel"),
		confirmStop: t("collaboration.confirmStop"),
		reload: t("collaboration.reload"),
		loading: t("collaboration.loading"),
		loadFailed: t("collaboration.loadFailed"),
		conflict: t("collaboration.conflict"),
		save: t("collaboration.save"),
		saving: t("collaboration.saving"),
		saved: t("collaboration.saved"),
		unsaved: t("collaboration.unsaved"),
		continueTask: t("collaboration.continueTask"),
		continuing: t("collaboration.continuing"),
		showMoreCandidates: t("collaboration.showMoreCandidates"),
		showFewerCandidates: t("collaboration.showFewerCandidates"),
		showAllTasks: t("collaboration.showAllTasks"),
		showFewerTasks: t("collaboration.showFewerTasks"),
	};
}

export function useProjectCollaborationModel(
	cwd: string,
	t: TFunction<"project">,
	language: string,
): ProjectCollaborationViewModel {
	const sessionsMap = useAtomValue(sessionsMapAtom);
	const setConfirm = useSetAtom(confirmDialogAtom);
	const [snapshot, setSnapshot] = useState<ProjectCollaborationSnapshot | null>(null);
	const [draft, setDraft] = useState<ProjectCollaborationConfig | null>(null);
	const [baseRevision, setBaseRevision] = useState<number | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [control, setControl] = useState<"pause" | "resume" | "stop" | "continue" | null>(null);
	const [controlTaskId, setControlTaskId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [search, setSearch] = useState("");
	const [expandedTaskIds, setExpandedTaskIds] = useState<string[]>([]);
	const requestVersion = useRef(0);
	const savingOperationRef = useRef<ProjectOperation | null>(null);
	const controlOperationRef = useRef<ProjectOperation | null>(null);
	const currentCwdRef = useRef(cwd);
	const cwdGenerationRef = useRef(0);
	if (currentCwdRef.current !== cwd) {
		currentCwdRef.current = cwd;
		cwdGenerationRef.current++;
	}
	const snapshotRef = useRef(snapshot);
	const draftRef = useRef(draft);
	snapshotRef.current = snapshot;
	draftRef.current = draft;

	const load = useCallback(
		async (discardDraft: boolean) => {
			const request = ++requestVersion.current;
			const generation = cwdGenerationRef.current;
			const isCurrentRequest = () =>
				currentCwdRef.current === cwd &&
				cwdGenerationRef.current === generation &&
				request === requestVersion.current;
			setLoading(true);
			try {
				const next = await window.agent567.project.readCollaboration(cwd);
				if (!isCurrentRequest()) return;
				const currentDraft = draftRef.current;
				const currentSnapshot = snapshotRef.current;
				if (
					discardDraft ||
					!currentDraft ||
					(currentSnapshot && sameConfig(currentDraft, currentSnapshot.config))
				) {
					draftRef.current = next.config;
					setDraft(next.config);
					setBaseRevision(next.config.revision);
				}
				snapshotRef.current = next;
				setSnapshot(next);
			} catch (cause) {
				if (!isCurrentRequest()) return;
				setError(cause instanceof Error ? cause.message : t("collaboration.loadFailed"));
			} finally {
				if (isCurrentRequest()) setLoading(false);
			}
		},
		[cwd, t],
	);

	useEffect(() => {
		let active = true;
		setSnapshot(null);
		setDraft(null);
		setBaseRevision(null);
		setLoading(true);
		setSaving(false);
		setControl(null);
		setControlTaskId(null);
		setError(null);
		void waitForCommittedPaint().then(() => {
			if (active) void load(true);
		});
		return () => {
			active = false;
			requestVersion.current++;
		};
	}, [load]);

	useEffect(() => {
		const unsubscribe = window.agent567.project.onCollaborationChanged((event) => {
			if (event.cwd === cwd) void load(false);
		});
		return unsubscribe;
	}, [cwd, load]);

	const isDirty = Boolean(snapshot && draft && !sameConfig(draft, snapshot.config));
	const updateDraft = useCallback((change: (current: ProjectCollaborationConfig) => ProjectCollaborationConfig) => {
		const current = draftRef.current;
		if (!current) return;
		const next = change(current);
		draftRef.current = next;
		setDraft(next);
		setError(null);
		setStatusMessage(null);
	}, []);

	const onSave = useCallback(async () => {
		if (
			!snapshot ||
			snapshot.cwd !== cwd ||
			!draft ||
			baseRevision == null ||
			!isDirty ||
			operationIsCurrent(savingOperationRef.current, cwd, cwdGenerationRef.current)
		)
			return;
		const operation = { cwd, generation: cwdGenerationRef.current };
		const operationCwd = cwd;
		const operationGeneration = cwdGenerationRef.current;
		const isCurrentOperation = () =>
			currentCwdRef.current === operationCwd && cwdGenerationRef.current === operationGeneration;
		savingOperationRef.current = operation;
		setSaving(true);
		setError(null);
		setStatusMessage(null);
		try {
			const updated = await window.agent567.project.updateCollaboration(cwd, {
				revision: baseRevision,
				enabled: draft.enabled,
				paused: draft.paused,
				coordinatorSessionId: draft.coordinatorSessionId,
				members: draft.members,
			});
			if (!isCurrentOperation()) return;
			requestVersion.current++;
			snapshotRef.current = updated;
			draftRef.current = updated.config;
			setSnapshot(updated);
			setDraft(updated.config);
			setBaseRevision(updated.config.revision);
			setStatusMessage(t("collaboration.saved"));
		} catch (cause) {
			if (isCurrentOperation()) setError(cause instanceof Error ? cause.message : t("collaboration.saveFailed"));
		} finally {
			if (savingOperationRef.current === operation) {
				savingOperationRef.current = null;
				if (isCurrentOperation()) setSaving(false);
			}
		}
	}, [baseRevision, cwd, draft, isDirty, snapshot, t]);

	const onControl = useCallback(
		async (action: "pause" | "resume" | "stop", taskId?: string) => {
			if (
				!snapshot ||
				snapshot.cwd !== cwd ||
				operationIsCurrent(controlOperationRef.current, cwd, cwdGenerationRef.current) ||
				saving ||
				isDirty
			)
				return;
			const operation = { cwd, generation: cwdGenerationRef.current };
			const operationCwd = cwd;
			const operationGeneration = cwdGenerationRef.current;
			const isCurrentOperation = () =>
				currentCwdRef.current === operationCwd && cwdGenerationRef.current === operationGeneration;
			controlOperationRef.current = operation;
			setControl(action);
			setControlTaskId(taskId ?? null);
			setError(null);
			setStatusMessage(null);
			try {
				const updated = await window.agent567.project.controlCollaboration(cwd, {
					action,
					...(taskId ? { taskId } : {}),
				});
				if (!isCurrentOperation()) return;
				requestVersion.current++;
				snapshotRef.current = updated;
				draftRef.current = updated.config;
				setSnapshot(updated);
				setDraft(updated.config);
				setBaseRevision(updated.config.revision);
			} catch (cause) {
				if (isCurrentOperation())
					setError(cause instanceof Error ? cause.message : t("collaboration.controlFailed"));
			} finally {
				if (controlOperationRef.current === operation) {
					controlOperationRef.current = null;
					if (isCurrentOperation()) {
						setControl(null);
						setControlTaskId(null);
					}
				}
			}
		},
		[cwd, isDirty, saving, snapshot, t],
	);

	const onContinueTask = useCallback(
		async (taskId: string) => {
			if (
				!snapshot ||
				snapshot.cwd !== cwd ||
				operationIsCurrent(controlOperationRef.current, cwd, cwdGenerationRef.current) ||
				saving ||
				isDirty
			)
				return;
			const operation = { cwd, generation: cwdGenerationRef.current };
			const operationCwd = cwd;
			const operationGeneration = cwdGenerationRef.current;
			const isCurrentOperation = () =>
				currentCwdRef.current === operationCwd && cwdGenerationRef.current === operationGeneration;
			controlOperationRef.current = operation;
			setControl("continue");
			setControlTaskId(taskId);
			setError(null);
			setStatusMessage(null);
			try {
				const updated = await window.agent567.project.controlCollaboration(cwd, { action: "continue", taskId });
				if (!isCurrentOperation()) return;
				requestVersion.current++;
				snapshotRef.current = updated;
				draftRef.current = updated.config;
				setSnapshot(updated);
				setDraft(updated.config);
				setBaseRevision(updated.config.revision);
			} catch (cause) {
				if (isCurrentOperation())
					setError(cause instanceof Error ? cause.message : t("collaboration.controlFailed"));
			} finally {
				if (controlOperationRef.current === operation) {
					controlOperationRef.current = null;
					if (isCurrentOperation()) {
						setControl(null);
						setControlTaskId(null);
					}
				}
			}
		},
		[cwd, isDirty, saving, snapshot, t],
	);

	const labels = useMemo(() => createLabels(t), [t]);
	const allCandidates = snapshot?.candidates ?? [];
	const candidateMap = useMemo(
		() => new Map(allCandidates.map((candidate) => [candidate.sessionId, candidate])),
		[allCandidates],
	);
	const sessions = useMemo(
		() => draft?.members ?? snapshot?.config.members ?? [],
		[draft?.members, snapshot?.config.members],
	);
	const members: ProjectCollaborationMemberView[] = sessions.map((member: ProjectCollaborationMember) => {
		const candidate = candidateMap.get(member.sessionId);
		return {
			sessionId: member.sessionId,
			name: candidateName(candidate, member.sessionId),
			responsibility: member.responsibility,
			access: member.access,
			model: candidate?.model ?? null,
			state: candidate?.state ?? "unavailable",
			stateLabel: t(`collaboration.state.${candidate?.state ?? "unavailable"}`),
		};
	});
	const candidates: ProjectCollaborationCandidateView[] = allCandidates.map((candidate) => ({
		sessionId: candidate.sessionId,
		name: candidateName(candidate, candidate.sessionId),
		preview: candidate.preview,
		model: candidate.model,
		state: candidate.state,
		stateLabel: t(`collaboration.state.${candidate.state}`),
		modifiedLabel: formatUpdatedAt(candidate.modifiedAt, language === "zh" ? "zh-CN" : "en-US"),
	}));
	const candidateNames = new Map(candidates.map((candidate) => [candidate.sessionId, candidate.name]));
	const projectSessions = sessionsMap.get(cwd) ?? [];
	const projectSessionById = new Map(projectSessions.map((session) => [session.id, session]));
	const tasks: ProjectCollaborationTaskView[] = (snapshot?.tasks ?? []).map((task: ProjectCollaborationTask) => {
		const targetName =
			candidateNames.get(task.targetSessionId) ??
			projectSessionById.get(task.targetSessionId)?.name ??
			task.targetSessionId;
		const sourceName =
			candidateNames.get(task.sourceSessionId) ??
			projectSessionById.get(task.sourceSessionId)?.name ??
			task.sourceSessionId;
		return {
			id: task.id,
			kind: task.kind,
			sourceSessionId: task.sourceSessionId,
			targetSessionId: task.targetSessionId,
			objective:
				task.kind === "result"
					? t("collaboration.memberResult", { source: sourceName, target: targetName })
					: task.objective,
			targetName,
			sourceName,
			kindLabel: t(`collaboration.taskKind.${task.kind}`),
			status: task.status,
			statusLabel: t(`collaboration.taskStatus.${task.status}`),
			result: task.result ?? null,
			error: task.error ?? null,
			updatedAt: task.finishedAt ?? task.startedAt ?? task.createdAt,
			updatedLabel: formatUpdatedAt(
				task.finishedAt ?? task.startedAt ?? task.createdAt,
				language === "zh" ? "zh-CN" : "en-US",
			),
		};
	});

	return {
		enabled: draft?.enabled ?? false,
		paused: draft?.paused ?? false,
		memberCount: draft?.members.length ?? 0,
		runningTaskCount:
			snapshot?.tasks.filter((task) => task.status === "running" || task.status === "waiting").length ?? 0,
		coordinatorSessionId: draft?.coordinatorSessionId ?? null,
		members,
		candidates,
		tasks,
		search,
		expandedTaskIds,
		loading,
		saving: saving || control != null,
		control,
		controlTaskId,
		error,
		statusMessage,
		dirty: isDirty,
		labels,
		onConfirmStop: (taskId) =>
			setConfirm({
				title: labels.stopConfirm,
				message: taskId ? labels.stopTaskConfirmMessage : labels.stopConfirmMessage,
				confirmLabel: labels.confirmStop,
				cancelLabel: labels.cancel,
				variant: "danger",
				onConfirm: () => {
					void onControl("stop", taskId);
				},
			}),
		onSearchChange: setSearch,
		onAdd: (sessionId) =>
			updateDraft((current) =>
				candidateMap.has(sessionId) && !current.members.some((member) => member.sessionId === sessionId)
					? { ...current, members: [...current.members, { sessionId, responsibility: "", access: "read" }] }
					: current,
			),
		onRemove: (sessionId) =>
			updateDraft((current) => ({
				...current,
				members: current.members.filter((member) => member.sessionId !== sessionId),
				coordinatorSessionId: current.coordinatorSessionId === sessionId ? null : current.coordinatorSessionId,
			})),
		onResponsibilityChange: (sessionId, responsibility) =>
			updateDraft((current) => ({
				...current,
				members: current.members.map((member) =>
					member.sessionId === sessionId ? { ...member, responsibility } : member,
				),
			})),
		onAccessChange: (sessionId, access) =>
			updateDraft((current) => ({
				...current,
				members: current.members.map((member) => (member.sessionId === sessionId ? { ...member, access } : member)),
			})),
		onCoordinatorChange: (sessionId) => updateDraft((current) => ({ ...current, coordinatorSessionId: sessionId })),
		onToggleEnabled: (enabled) => updateDraft((current) => ({ ...current, enabled })),
		onControl,
		onContinueTask,
		onToggleTask: (taskId) =>
			setExpandedTaskIds((current) =>
				current.includes(taskId) ? current.filter((id) => id !== taskId) : [...current, taskId],
			),
		onSave,
		onOpenSession: (sessionId) => {
			const candidate = candidateMap.get(sessionId);
			const session = projectSessionById.get(sessionId);
			const path = candidate?.path ?? session?.path;
			if (path && openSessionFnRef.current) void openSessionFnRef.current(cwd, path);
		},
		onReload: () => {
			const reload = () => {
				if (currentCwdRef.current !== cwd) return;
				setError(null);
				draftRef.current = null;
				setDraft(null);
				setBaseRevision(null);
				setStatusMessage(null);
				void load(true);
			};
			if (!isDirty) {
				reload();
				return;
			}
			setConfirm({
				title: labels.reload,
				message: t("collaboration.discardDraft"),
				confirmLabel: t("collaboration.discardAndReload"),
				cancelLabel: labels.cancel,
				onConfirm: reload,
			});
		},
	};
}
