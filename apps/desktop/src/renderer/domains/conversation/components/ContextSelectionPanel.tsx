import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextWorkspaceModel } from "../hooks/useContextWorkspace";
import {
	type ContextTurnFilter,
	type EffectiveTurnStatus,
	filterEvaluatedTurns,
	summarizeContextWorkspace,
} from "./context-workspace-summary";

const STATUS_BADGE_CLASS: Record<EffectiveTurnStatus, string> = {
	included: "bg-emerald-500/15 text-emerald-400",
	summarized: "bg-amber-500/15 text-amber-400",
	excluded: "bg-muted text-muted-foreground",
};

export function ContextSelectionPanel({
	model,
	hasSession,
	pendingAttachmentCount = 0,
}: {
	model: ContextWorkspaceModel;
	hasSession: boolean;
	pendingAttachmentCount?: number;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<ContextTurnFilter>("all");
	const [anchor, setAnchor] = useState<string | null>(null);
	const [expandedTurns, setExpandedTurns] = useState<Readonly<Record<string, boolean>>>({});
	const [pinnedOpen, setPinnedOpen] = useState(model.pinned.length > 0);
	const [summaryOpen, setSummaryOpen] = useState(false);
	const state = model.snapshot;
	const prevPinnedLength = useRef(model.pinned.length);
	useEffect(() => {
		if (prevPinnedLength.current === 0 && model.pinned.length > 0) setPinnedOpen(true);
		prevPinnedLength.current = model.pinned.length;
	}, [model.pinned.length]);
	const summary = useMemo(
		() => (state ? summarizeContextWorkspace(state, model.pinned, model.excluded) : null),
		[state, model.pinned, model.excluded],
	);
	const filteredTurns = useMemo(
		() => (summary ? filterEvaluatedTurns(summary.evaluatedTurns, filter, query) : []),
		[summary, filter, query],
	);
	const disabled = model.busy || !state || state.busy;
	const readOnlyRunning = Boolean(state?.busy || model.busy);
	const selected = filteredTurns.filter((entry) => !entry.isExcluded).length;
	const toggleExpanded = (turnId: string) =>
		setExpandedTurns((current) => ({ ...current, [turnId]: !current[turnId] }));
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
			<div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-2 [overflow-wrap:anywhere] [scrollbar-gutter:stable]">
				{!state && !model.error && (
					<div className="rounded-xl border border-border/50 bg-card/30 px-4 py-6 text-center">
						<p role="status" className="text-[12px] text-muted-foreground">
							{t(hasSession ? "contextWorkspace.loading" : "contextWorkspace.noSession")}
						</p>
					</div>
				)}
				{!state && model.error && (
					<div className="space-y-2 rounded-xl border border-border/50 bg-card/30 px-4 py-6 text-center">
						<p role="alert" className="text-[12px] text-destructive">
							{t("contextWorkspace.failed")}
						</p>
						{hasSession && (
							<Button size="xs" variant="outline" onClick={model.refresh}>
								{t("contextWorkspace.retry")}
							</Button>
						)}
					</div>
				)}
				{state && summary && (
					<>
						<section
							aria-label={t("contextWorkspace.nextSendTitle")}
							className="space-y-2.5 rounded-xl border border-border/60 bg-card/40 px-3.5 py-3"
						>
							<div className="flex flex-wrap items-center gap-2">
								<h2 className="text-[12px] font-medium text-foreground">{t("contextWorkspace.nextSendTitle")}</h2>
								{model.dirty ? (
									<span className="inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
										{t("contextWorkspace.unsavedBadge")}
									</span>
								) : (
									<span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
										{t(model.saved ? "contextWorkspace.saved" : "contextWorkspace.syncedBadge")}
									</span>
								)}
								{readOnlyRunning && (
									<span className="ml-auto inline-flex items-center rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-400">
										{t("contextWorkspace.readOnlyRunning")}
									</span>
								)}
							</div>
							<div className="grid grid-cols-[repeat(auto-fill,minmax(min(175px,100%),1fr))] gap-2">
								<div className="rounded-lg border border-border/40 bg-background/50 px-2.5 py-2">
									<div className="text-[11px] text-muted-foreground">{t("contextWorkspace.nextSendTurns")}</div>
									<div className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">
										{t("contextWorkspace.nextSendTurnsValue", {
											included: summary.includedCount,
											shown: state.turns.length,
										})}
									</div>
									<div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
										{t("contextWorkspace.nextSendTurnsBreakdown", {
											summarized: summary.summarizedCount,
											excluded: summary.excludedCount,
										})}
									</div>
								</div>
								<div className="rounded-lg border border-border/40 bg-background/50 px-2.5 py-2">
									<div className="text-[11px] text-muted-foreground">{t("contextWorkspace.nextSendPinned")}</div>
									<div className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">
										{model.pinned.trim().length > 0
											? t("contextWorkspace.nextSendPinnedValue", { count: model.pinned.trim().length })
											: t("contextWorkspace.nextSendPinnedUnset")}
									</div>
								</div>
								<div className="rounded-lg border border-border/40 bg-background/50 px-2.5 py-2">
									<div className="text-[11px] text-muted-foreground">{t("contextWorkspace.nextSendSummary")}</div>
									<div
										className={`mt-0.5 text-[13px] font-medium ${summary.summaryWillRebuild ? "text-amber-400" : "text-foreground"}`}
									>
										{summary.summaryWillRebuild
											? t("contextWorkspace.nextSendSummaryRebuild")
											: state.summary
												? t("contextWorkspace.nextSendSummaryActive")
												: t("contextWorkspace.nextSendSummaryNone")}
									</div>
									{!summary.summaryWillRebuild && state.tokensBefore !== null && (
										<div className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
											{t("contextWorkspace.nextSendSummaryTokens", { count: state.tokensBefore })}
										</div>
									)}
								</div>
								<div className="rounded-lg border border-border/40 bg-background/50 px-2.5 py-2">
									<div className="text-[11px] text-muted-foreground">{t("contextWorkspace.nextSendDraftFiles")}</div>
									<div className="mt-0.5 text-[13px] font-medium tabular-nums text-foreground">
										{pendingAttachmentCount > 0
											? t("contextWorkspace.nextSendDraftFilesValue", { count: pendingAttachmentCount })
											: t("contextWorkspace.nextSendDraftFilesNone")}
									</div>
								</div>
							</div>
							<p
								className={`text-[11px] ${summary.summaryWillRebuild ? "text-amber-400" : "text-muted-foreground"}`}
							>
								{t(summary.summaryWillRebuild ? "contextWorkspace.saveImpactRebuild" : "contextWorkspace.saveImpact")}
							</p>
						</section>
						<section className="rounded-xl border border-border/50 bg-card/30 px-3.5 py-3">
							<div className="flex flex-wrap items-center gap-2">
								<h3 className="text-[13px] font-medium text-foreground">{t("contextWorkspace.pinned")}</h3>
								<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
									{t("contextWorkspace.pinnedCount", { count: model.pinned.length })}
								</span>
								<div className="ml-auto flex items-center gap-1">
									{model.pinned.length > 0 && (
										<Button
											size="xs"
											variant="ghost"
											disabled={disabled}
											onClick={() => model.setPinned("")}
										>
											{t("contextWorkspace.clearPinned")}
										</Button>
									)}
									<Button
										size="xs"
										variant="ghost"
										onClick={() => setPinnedOpen((open) => !open)}
									>
										{t(pinnedOpen ? "contextWorkspace.collapseSection" : "contextWorkspace.expandSection")}
									</Button>
								</div>
							</div>
							{pinnedOpen && (
								<Textarea
									aria-label={t("contextWorkspace.pinned")}
									className="mt-2.5 min-h-24 w-full resize-y rounded-lg border border-border bg-background p-3 text-[13px]"
									maxLength={16000}
									value={model.pinned}
									onChange={(event) => model.setPinned(event.target.value)}
									disabled={disabled}
								/>
							)}
						</section>
						{(state.summary || state.previousSummary) && (
							<section className="rounded-xl border border-border/50 bg-card/30 px-3.5 py-3">
								<div className="flex flex-wrap items-center gap-2">
									<h3 className="text-[13px] font-medium text-foreground">{t("contextWorkspace.summary")}</h3>
									<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
										{t("contextWorkspace.readOnlyTag")}
									</span>
									{summary.summaryWillRebuild && (
										<span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-400">
											{t("contextWorkspace.nextSendSummaryRebuild")}
										</span>
									)}
									<Button
										size="xs"
										variant="ghost"
										className="ml-auto"
										onClick={() => setSummaryOpen((open) => !open)}
									>
										{t(summaryOpen ? "contextWorkspace.collapseDetails" : "contextWorkspace.expandDetails")}
									</Button>
								</div>
								{summaryOpen && (
									<div className="mt-2.5 space-y-2.5 border-t border-border/40 pt-2.5">
										{state.summary && (
											<p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
												{state.summary}
											</p>
										)}
										{state.previousSummary && (
											<div className="rounded-lg border border-border/40 bg-background/50 p-2.5">
												<h4 className="text-[11px] font-medium text-muted-foreground">
													{t("contextWorkspace.previous")}
												</h4>
												<p className="mt-1.5 whitespace-pre-wrap text-[12px] text-muted-foreground">
													{state.previousSummary}
												</p>
											</div>
										)}
									</div>
								)}
							</section>
						)}
						<section className="space-y-2.5">
							<div className="flex flex-wrap items-center gap-2">
								<div className="relative min-w-[180px] flex-1">
									<Input
										value={query}
										onChange={(event) => setQuery(event.target.value)}
										aria-label={t("contextWorkspace.search")}
										placeholder={t("contextWorkspace.search")}
										className={`w-full text-[12px] ${query.length > 0 ? "pr-8" : ""}`}
									/>
									{query.length > 0 && (
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label={t("contextWorkspace.clearSearch")}
											className="absolute top-1/2 right-1 -translate-y-1/2"
											onClick={() => setQuery("")}
										>
											<span className="icon-[solar--close-circle-linear] h-3.5 w-3.5" aria-hidden="true" />
										</Button>
									)}
								</div>
								<div
									className="flex flex-wrap items-center gap-1"
									role="group"
									aria-label={t("contextWorkspace.turns", { count: state.totalTurns })}
								>
									{(
										[
											["all", summary.evaluatedTurns.length],
											["included", summary.includedCount],
											["excluded", summary.excludedCount],
											["summarized", summary.summarizedCount],
										] as const
									).map(([key, count]) => (
										<Button
											key={key}
											size="xs"
											variant={filter === key ? "secondary" : "ghost"}
											onClick={() => setFilter(key)}
											aria-pressed={filter === key}
										>
											{t(`contextWorkspace.filter.${key}`, { count })}
										</Button>
									))}
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-1.5">
								<span className="mr-auto text-[11px] text-muted-foreground">
									{t("contextWorkspace.selection", { selected, count: filteredTurns.length })}
									{state.totalTurns > state.turns.length
										? ` · ${t("contextWorkspace.nextSendTurnsTotal", { shown: state.turns.length, total: state.totalTurns })}`
										: ""}
								</span>
								<Button
									size="xs"
									variant="outline"
									disabled={disabled || filteredTurns.length === 0}
									onClick={() =>
										model.setIncluded(
											filteredTurns.map((entry) => entry.turn.id),
											true,
										)
									}
								>
									{t("contextWorkspace.includeShown")}
								</Button>
								<Button
									size="xs"
									variant="outline"
									disabled={disabled || filteredTurns.length === 0}
									onClick={() =>
										model.setIncluded(
											filteredTurns.map((entry) => entry.turn.id),
											false,
										)
									}
								>
									{t("contextWorkspace.excludeShown")}
								</Button>
							</div>
							<div className="divide-y divide-border/40 rounded-xl border border-border/50 bg-card/20">
								{filteredTurns.map(({ turn, effectiveStatus, isExcluded, isModified }) => {
									const isExpanded = Boolean(expandedTurns[turn.id]);
									const isAlreadyPinned = !turn.text || model.pinned.includes(turn.text);
									return (
										<div
											key={turn.id}
											className={`min-w-0 px-3 py-2.5 transition-colors ${isExcluded ? "bg-muted/20 opacity-75" : ""}`}
										>
											<div className="flex min-w-0 items-start gap-2.5">
												<input
													type="checkbox"
													className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
													aria-label={turn.text.slice(0, 80) || t("contextWorkspace.attachmentTurn")}
													checked={!isExcluded}
													disabled={disabled}
													onChange={(event) => {
														const current = filteredTurns.findIndex((entry) => entry.turn.id === turn.id);
														const start = filteredTurns.findIndex((entry) => entry.turn.id === anchor);
														const shift = "shiftKey" in event.nativeEvent && event.nativeEvent.shiftKey === true;
														model.setIncluded(
															shift && start >= 0
																? filteredTurns
																		.slice(Math.min(start, current), Math.max(start, current) + 1)
																		.map((entry) => entry.turn.id)
																: [turn.id],
															event.target.checked,
														);
														setAnchor(turn.id);
													}}
												/>
												<div className="min-w-0 flex-1">
													<div className="flex flex-wrap items-center gap-1.5">
														<span
															className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE_CLASS[effectiveStatus]}`}
														>
															{t(`contextWorkspace.${effectiveStatus}`)}
														</span>
														{isModified && (
															<span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
																{t("contextWorkspace.modifiedBadge")}
															</span>
														)}
														{turn.attachments.length > 0 && (
															<span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
																{t("contextWorkspace.attachmentsCount", { count: turn.attachments.length })}
															</span>
														)}
													</div>
													<p className="mt-1 line-clamp-2 text-[13px] leading-snug text-foreground">
														{turn.text || t("contextWorkspace.attachmentTurn")}
													</p>
												</div>
												<Button
													size="xs"
													variant="ghost"
													className="shrink-0"
													onClick={() => toggleExpanded(turn.id)}
												>
													{t(isExpanded ? "contextWorkspace.collapseDetails" : "contextWorkspace.expandDetails")}
												</Button>
											</div>
											{isExpanded && (
												<div className="mt-2 ml-6 space-y-2 rounded-lg border border-border/40 bg-background/60 p-2.5">
													{turn.text && (
														<p className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
															{turn.text}
														</p>
													)}
													{turn.attachments.length > 0 && (
														<div className="space-y-1 border-t border-border/40 pt-2">
															{turn.attachments.map((path) => (
																<span key={path} className="block truncate text-[11px] text-muted-foreground">
																	{path}
																</span>
															))}
														</div>
													)}
													{turn.text && (
														<div className="flex flex-wrap items-center justify-end gap-2 pt-1">
															<Button
																size="xs"
																variant="outline"
																disabled={
																	disabled ||
																	isAlreadyPinned ||
																	model.pinned.length + turn.text.length + 2 > 16000
																}
																onClick={() => {
																	setPinnedOpen(true);
																	model.setPinned([model.pinned, turn.text].filter(Boolean).join("\n\n"));
																}}
															>
																{t(isAlreadyPinned ? "contextWorkspace.pinnedDone" : "contextWorkspace.pinPreview")}
															</Button>
														</div>
													)}
												</div>
											)}
										</div>
									);
								})}
								{filteredTurns.length === 0 && (
									<div className="space-y-2 py-6 text-center">
										<p className="text-[12px] text-muted-foreground">
											{t(state.turns.length === 0 ? "contextWorkspace.noTurns" : "workbench.noMatches")}
										</p>
										{state.turns.length > 0 && (filter !== "all" || query.trim() !== "") && (
											<Button
												size="xs"
												variant="outline"
												onClick={() => {
													setFilter("all");
													setQuery("");
												}}
											>
												{t("contextWorkspace.resetFilters")}
											</Button>
										)}
									</div>
								)}
							</div>
						</section>
					</>
				)}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3">
				<p
					role={model.error ? "alert" : "status"}
					className={`mr-auto min-w-0 flex-1 text-[12px] ${
						model.error
							? "text-destructive"
							: model.dirty
								? "text-amber-400"
								: model.saved
									? "text-emerald-400"
									: "text-muted-foreground"
					}`}
				>
					{model.error
						? t("contextWorkspace.failed")
						: readOnlyRunning
							? t("contextWorkspace.readOnlyRunning")
							: model.dirty && summary
								? t("contextWorkspace.unsavedTurns", { count: summary.changeCount })
								: model.saved
									? t("contextWorkspace.saved")
									: t("contextWorkspace.syncedFooter")}
				</p>
				<Button variant="ghost" disabled={disabled || !model.dirty} onClick={model.reset}>
					{t("contextWorkspace.reset")}
				</Button>
				<Button variant="primary" disabled={disabled || !model.dirty} onClick={() => void model.save()}>
					{t(model.busy ? "contextWorkspace.saving" : "contextWorkspace.save")}
				</Button>
			</div>
		</div>
	);
}
