import { Button } from "@vetta-org/ui";
import { useState, type JSX } from "react";

export type ProjectCollaborationMemberState = "idle" | "running" | "unavailable";

export interface ProjectCollaborationMemberView {
	sessionId: string;
	name: string;
	responsibility: string;
	access: "read" | "write";
	model: string | null;
	state: ProjectCollaborationMemberState;
	stateLabel: string;
}

export interface ProjectCollaborationCandidateView {
	sessionId: string;
	name: string;
	preview: string;
	model: string | null;
	state: ProjectCollaborationMemberState;
	stateLabel: string;
	modifiedLabel: string;
}

export interface ProjectCollaborationTaskView {
	id: string;
	kind: "task" | "question" | "notice" | "result";
	sourceSessionId: string;
	targetSessionId: string;
	objective: string;
	targetName: string;
	sourceName: string;
	kindLabel: string;
	status: "queued" | "running" | "waiting" | "completed" | "failed" | "interrupted" | "cancelled" | "attention";
	statusLabel: string;
	result: string | null;
	error: string | null;
	updatedAt: number;
	updatedLabel: string;
}

export interface ProjectCollaborationViewLabels {
	title: string;
	enabled: string;
	paused: string;
	stopped: string;
	memberCount: string;
	runningTasks: string;
	coordinator: string;
	coordinatorBadge: string;
	noCoordinator: string;
	members: string;
	candidates: string;
	search: string;
	add: string;
	remove: string;
	responsibility: string;
	responsibilityPlaceholder: string;
	access: string;
	read: string;
	write: string;
	model: string;
	state: string;
	openSession: string;
	noMembers: string;
	noCandidates: string;
	noCandidatesMatch: string;
	emptyTitle: string;
	emptyDescription: string;
	exampleOne: string;
	exampleTwo: string;
	tasks: string;
	noTasks: string;
	taskSource: string;
	taskTarget: string;
	showResult: string;
	hideResult: string;
	openSource: string;
	openTarget: string;
	pause: string;
	resume: string;
	stop: string;
	stopConfirm: string;
	stopConfirmMessage: string;
	stopTaskConfirmMessage: string;
	cancel: string;
	confirmStop: string;
	reload: string;
	loading: string;
	loadFailed: string;
	conflict: string;
	save: string;
	saving: string;
	saved: string;
	unsaved: string;
	continueTask: string;
	continuing: string;
	showMoreCandidates: string;
	showFewerCandidates: string;
	showAllTasks: string;
	showFewerTasks: string;
}

export interface ProjectCollaborationViewProps {
	enabled: boolean;
	paused: boolean;
	memberCount: number;
	runningTaskCount: number;
	coordinatorSessionId: string | null;
	members: readonly ProjectCollaborationMemberView[];
	candidates: readonly ProjectCollaborationCandidateView[];
	tasks: readonly ProjectCollaborationTaskView[];
	search: string;
	expandedTaskIds: readonly string[];
	loading: boolean;
	saving: boolean;
	control: "pause" | "resume" | "stop" | "continue" | null;
	controlTaskId: string | null;
	error: string | null;
	statusMessage: string | null;
	dirty: boolean;
	labels: ProjectCollaborationViewLabels;
	onSearchChange: (value: string) => void;
	onAdd: (sessionId: string) => void;
	onRemove: (sessionId: string) => void;
	onResponsibilityChange: (sessionId: string, value: string) => void;
	onAccessChange: (sessionId: string, value: "read" | "write") => void;
	onCoordinatorChange: (sessionId: string | null) => void;
	onToggleEnabled: (value: boolean) => void;
	onControl: (action: "pause" | "resume" | "stop", taskId?: string) => void;
	onConfirmStop: (taskId?: string) => void;
	onContinueTask: (taskId: string) => void;
	onToggleTask: (taskId: string) => void;
	onSave: () => void;
	onOpenSession: (sessionId: string) => void;
	onReload: () => void;
}

export function ProjectCollaborationView({
	enabled,
	paused,
	memberCount,
	runningTaskCount,
	coordinatorSessionId,
	members,
	candidates,
	tasks,
	search,
	expandedTaskIds,
	loading,
	saving,
	control,
	controlTaskId,
	error,
	statusMessage,
	dirty,
	labels,
	onSearchChange,
	onAdd,
	onRemove,
	onResponsibilityChange,
	onAccessChange,
	onCoordinatorChange,
	onToggleEnabled,
	onControl,
	onConfirmStop,
	onContinueTask,
	onToggleTask,
	onOpenSession,
	onSave,
	onReload,
}: ProjectCollaborationViewProps): JSX.Element {
	const [tasksOpen, setTasksOpen] = useState(false);
	const [tasksExpanded, setTasksExpanded] = useState(false);
	const [candidatesExpanded, setCandidatesExpanded] = useState(false);
	const stateTone = enabled && !paused ? "text-emerald-400" : "text-muted-foreground";
	const filteredCandidates = candidates.filter((candidate) =>
		`${candidate.name} ${candidate.preview} ${candidate.model ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
	);
	const memberIds = new Set(members.map((member) => member.sessionId));
	const availableCandidates = filteredCandidates.filter((candidate) => !memberIds.has(candidate.sessionId));
	const visibleCandidates = candidatesExpanded ? availableCandidates : availableCandidates.slice(0, 8);

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
			<section aria-labelledby="project-collaboration-heading" className="flex min-w-0 flex-col gap-3 pb-4">
				<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<h2 id="project-collaboration-heading" className="text-[14px] font-semibold text-foreground">{labels.title}</h2>
						<span className={`inline-flex items-center gap-1.5 text-[11px] ${stateTone}`}>
							<span className={`h-2 w-2 rounded-full ${enabled && !paused ? "bg-emerald-500" : "bg-muted-foreground/40"}`} aria-hidden="true" />
							{enabled ? (paused ? labels.paused : labels.enabled) : labels.stopped}
						</span>
						<span className="text-[11px] text-muted-foreground">{labels.memberCount}: {memberCount}</span>
						<span className="text-[11px] text-muted-foreground">{labels.runningTasks}: {runningTaskCount}</span>
					</div>
					<label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
						<input type="checkbox" checked={enabled} disabled={saving || loading} onChange={(event) => onToggleEnabled(event.target.checked)} />
						{labels.enabled}
					</label>
				</div>

				{loading && <p className="text-[12px] text-muted-foreground" role="status">{labels.loading}</p>}

				{members.length > 0 ? (
					<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60">
						<table className="w-full min-w-[40rem] table-fixed text-left text-[12px]">
							<thead className="border-b border-border/50 bg-accent/30 text-[11px] text-muted-foreground">
								<tr><th className="w-[18%] px-3 py-2">{labels.members}</th><th className="w-[32%] px-3 py-2">{labels.responsibility}</th><th className="w-[12%] px-3 py-2">{labels.access}</th><th className="w-[16%] px-3 py-2">{labels.model}</th><th className="w-[12%] px-3 py-2">{labels.state}</th><th className="w-[10%] px-2 py-2"><span className="sr-only">{labels.remove}</span></th></tr>
							</thead>
							<tbody>
								{members.map((member) => (
									<tr key={member.sessionId} className="border-b border-border/30 last:border-b-0">
										<td className="px-3 py-2">
											<div className="flex min-w-0 items-center gap-1">
												<Button variant="ghost" size="sm" className="h-auto min-w-0 max-w-full flex-1 justify-start truncate px-1 py-0.5 text-left" onClick={() => onOpenSession(member.sessionId)} title={member.name}>{member.name}</Button>
												{member.sessionId === coordinatorSessionId && <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] text-primary" title={labels.coordinator}>{labels.coordinatorBadge}</span>}
											</div>
										</td>
										<td className="px-3 py-2"><input value={member.responsibility} onChange={(event) => onResponsibilityChange(member.sessionId, event.target.value)} disabled={saving || loading} aria-label={`${labels.responsibility}: ${member.name}`} placeholder={labels.responsibilityPlaceholder} className="h-7 w-full min-w-0 rounded-md border border-border/60 bg-background/70 px-2 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring" /></td>
										<td className="px-3 py-2"><select value={member.access} onChange={(event) => onAccessChange(member.sessionId, event.target.value as "read" | "write")} disabled={saving || loading} aria-label={`${labels.access}: ${member.name}`} className="h-7 max-w-full rounded-md border border-border/60 bg-background px-1.5 text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"><option value="read">{labels.read}</option><option value="write">{labels.write}</option></select></td>
										<td className="truncate px-3 py-2 text-muted-foreground" title={member.model ?? undefined}>{member.model ?? "—"}</td>
										<td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground"><span className={`h-2 w-2 rounded-full ${member.state === "running" ? "bg-emerald-500" : member.state === "unavailable" ? "bg-destructive" : "bg-muted-foreground/40"}`} aria-hidden="true" />{member.stateLabel}</span></td>
										<td className="px-2 py-2"><Button variant="ghost" size="icon-sm" disabled={saving || loading} onClick={() => onRemove(member.sessionId)} aria-label={`${labels.remove}: ${member.name}`} title={saving ? labels.saving : loading ? labels.loading : `${labels.remove}: ${member.name}`}><span className="icon-[solar--trash-bin-trash-linear] h-4 w-4" aria-hidden="true" /></Button></td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/50 bg-card/30 p-3">
						<p className="text-[12px] font-medium text-foreground">{labels.emptyTitle}</p>
						<p className="text-[12px] text-muted-foreground">{labels.emptyDescription}</p>
						<ol className="list-inside list-decimal text-[11px] text-muted-foreground"><li>{labels.exampleOne}</li><li>{labels.exampleTwo}</li></ol>
					</div>
				)}

				<div className="flex min-w-0 flex-col gap-2">
					<div className="flex min-w-0 items-center justify-between gap-2"><h3 className="text-[12px] font-medium text-foreground">{labels.candidates}</h3><label className="flex min-w-[10rem] max-w-[18rem] flex-1 items-center"><span className="sr-only">{labels.search}</span><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={labels.search} className="h-7 w-full min-w-0 rounded-md border border-border/50 bg-background px-2 text-[11px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring" /></label></div>
					<div className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2">{visibleCandidates.map((candidate) => <div key={candidate.sessionId} className="flex min-w-0 items-center gap-2 rounded-lg border border-border/50 px-2.5 py-2"><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium text-foreground" title={candidate.name}>{candidate.name}</p><p className="truncate text-[10px] text-muted-foreground" title={candidate.preview}>{candidate.preview || candidate.modifiedLabel}{candidate.model ? ` · ${candidate.model}` : ""}</p></div><Button variant="outline" size="sm" disabled={saving || loading} onClick={() => onAdd(candidate.sessionId)}>{labels.add}</Button></div>)}{availableCandidates.length === 0 && <p className="text-[11px] text-muted-foreground">{search ? labels.noCandidatesMatch : labels.noCandidates}</p>}</div>
					{availableCandidates.length > 8 && <Button variant="ghost" size="sm" className="self-start" onClick={() => setCandidatesExpanded((expanded) => !expanded)}>{candidatesExpanded ? labels.showFewerCandidates : labels.showMoreCandidates}</Button>}
				</div>
			</section>

			<section aria-labelledby="project-collaboration-tasks" className="flex min-w-0 flex-col gap-2 border-t border-border/50 pt-3">
				<button id="project-collaboration-tasks" type="button" aria-expanded={tasksOpen} onClick={() => setTasksOpen((open) => !open)} className="flex min-h-9 min-w-0 items-center gap-2 text-left text-[12px] font-medium text-foreground">
					<span className={`icon-[solar--alt-arrow-down-linear] h-3.5 w-3.5 shrink-0 transition-transform ${tasksOpen ? "rotate-180" : ""}`} aria-hidden="true" />
					<span className="min-w-0 flex-1">{labels.tasks}</span>
					<span className="shrink-0 text-[11px] font-normal text-muted-foreground">{tasks.length}</span>
				</button>
				{tasksOpen && (tasks.length === 0 ? (
					<p className="text-[11px] text-muted-foreground">{labels.noTasks}</p>
				) : (
					<>
					<ul className="flex min-w-0 flex-col divide-y divide-border/40">
						{[...tasks]
							.sort((left, right) => {
								const active = (status: ProjectCollaborationTaskView["status"]) =>
									["queued", "running", "waiting"].includes(status) ? 1 : 0;
								return active(right.status) - active(left.status) || right.updatedAt - left.updatedAt;
							})
							.slice(0, tasksExpanded ? tasks.length : 8)
							.map((task) => {
							const expanded = expandedTaskIds.includes(task.id);
							const canContinue = ["interrupted", "failed", "attention", "cancelled"].includes(task.status);
							const canStop = ["queued", "running", "waiting"].includes(task.status);
							return (
								<li key={task.id} className="min-w-0 py-2">
									<button type="button" onClick={() => onToggleTask(task.id)} aria-expanded={expanded} className="flex w-full min-w-0 items-center gap-2 text-left">
										<span className="icon-[solar--alt-arrow-down-linear] h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
										<span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{task.objective}</span>
										<span className="shrink-0 text-[10px] text-muted-foreground">{task.targetName} · {task.statusLabel} · {task.updatedLabel}</span>
									</button>
									{expanded && (
										<div className="ml-5 mt-2 flex min-w-0 flex-col gap-2 text-[11px] text-muted-foreground">
											<p>{labels.taskSource}: {task.sourceName} · {labels.taskTarget}: {task.targetName} · {task.kindLabel}</p>
											{task.kind !== "result" && <p className="select-text whitespace-pre-wrap text-foreground">{task.objective}</p>}
											{task.error && <p className="text-destructive">{task.error}</p>}
											{task.result && <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-accent/30 p-2 font-sans text-[11px]">{task.result}</pre>}
											<div className="flex flex-wrap gap-1.5">
												<Button variant="ghost" size="sm" onClick={() => onOpenSession(task.sourceSessionId)}>{labels.openSource}</Button>
												<Button variant="ghost" size="sm" onClick={() => onOpenSession(task.targetSessionId)}>{labels.openTarget}</Button>
												{canStop && <Button variant="destructive" size="sm" disabled={control != null || saving || dirty || loading} onClick={() => onConfirmStop(task.id)}>{control === "stop" && controlTaskId === task.id ? labels.saving : labels.stop}</Button>}
											{canContinue && <Button variant="outline" size="sm" disabled={control != null || saving || dirty || loading} onClick={() => onContinueTask(task.id)}>{control === "continue" && controlTaskId === task.id ? labels.continuing : labels.continueTask}</Button>}
											</div>
										</div>
									)}
								</li>
							);
						})}
					</ul>
					{tasks.length > 8 && <Button variant="ghost" size="sm" className="self-start" onClick={() => setTasksExpanded((expanded) => !expanded)}>{tasksExpanded ? labels.showFewerTasks : labels.showAllTasks}</Button>}
					</>
				))}
			</section>
		</div>
			<footer className="sticky bottom-0 z-10 shrink-0 border-t border-border/60 bg-background/95 px-3 py-2.5 backdrop-blur @md:px-4">
				{error && <div role="alert" className="mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[12px] text-destructive"><span className="min-w-0 flex-1">{error}</span><Button variant="outline" size="sm" onClick={onReload}>{labels.reload}</Button></div>}
				{statusMessage && <p role="status" className="mb-2 text-[12px] text-muted-foreground">{statusMessage}</p>}
				<div className="flex min-w-0 flex-wrap items-end gap-2">
					<label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-[10px] text-muted-foreground">
						<span>{labels.coordinator}</span>
						<select value={coordinatorSessionId ?? ""} onChange={(event) => onCoordinatorChange(event.target.value || null)} disabled={saving || loading || members.length === 0} className="h-8 min-w-0 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring">
							<option value="">{labels.noCoordinator}</option>
							{members.map((member) => <option key={member.sessionId} value={member.sessionId}>{member.name}</option>)}
						</select>
					</label>
					<div className="flex flex-wrap items-center gap-1.5">
						<Button variant={dirty ? "primary" : "outline"} size="sm" disabled={!dirty || saving || loading} onClick={onSave}>{saving && control == null ? labels.saving : labels.save}</Button>
						{paused ? <Button variant="outline" size="sm" disabled={control != null || saving || dirty || loading} onClick={() => onControl("resume")}>{control === "resume" ? labels.saving : labels.resume}</Button> : <Button variant="outline" size="sm" disabled={!enabled || control != null || saving || dirty || loading} onClick={() => onControl("pause")}>{control === "pause" ? labels.saving : labels.pause}</Button>}
						<Button variant="destructive" size="sm" disabled={!enabled || control != null || saving || dirty || loading || !tasks.some((task) => ["queued", "running", "waiting"].includes(task.status))} onClick={() => onConfirmStop()}>{control === "stop" ? labels.saving : labels.stop}</Button>
					</div>
				</div>
			</footer>
		</div>
	);
}
