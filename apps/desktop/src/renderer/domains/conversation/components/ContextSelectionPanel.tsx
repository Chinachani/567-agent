import { Button } from "@shared/components/ui/button";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ContextWorkspaceModel } from "../hooks/useContextWorkspace";

export function ContextSelectionPanel({
	model,
	hasSession,
}: {
	model: ContextWorkspaceModel;
	hasSession: boolean;
}): JSX.Element {
	const { t } = useTranslation("chat");
	const [query, setQuery] = useState("");
	const [anchor, setAnchor] = useState<string | null>(null);
	const state = model.snapshot;
	const turns = useMemo(
		() =>
			[...(state?.turns ?? [])]
				.reverse()
				.filter((turn) =>
					`${turn.text}\n${turn.attachments.join("\n")}`
						.toLocaleLowerCase()
						.includes(query.trim().toLocaleLowerCase()),
				),
		[state, query],
	);
	const disabled = model.busy || !state || state.busy;
	const selected = turns.filter((turn) => !model.excluded.includes(turn.id)).length;
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
			<div className="shrink-0 space-y-2">
				<input
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					aria-label={t("contextWorkspace.search")}
					placeholder={t("contextWorkspace.search")}
					className="w-full min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-[12px]"
				/>
				<div className="flex flex-wrap items-center gap-1.5">
					<span className="mr-auto text-[12px] text-muted-foreground">
						{t("contextWorkspace.selection", { selected, count: turns.length })}
					</span>
					<Button
						size="xs"
						variant="outline"
						disabled={disabled || turns.length === 0}
						onClick={() =>
							model.setIncluded(
								turns.map((turn) => turn.id),
								true,
							)
						}
					>
						{t("contextWorkspace.includeShown")}
					</Button>
					<Button
						size="xs"
						variant="outline"
						disabled={disabled || turns.length === 0}
						onClick={() =>
							model.setIncluded(
								turns.map((turn) => turn.id),
								false,
							)
						}
					>
						{t("contextWorkspace.excludeShown")}
					</Button>
				</div>
			</div>
			<div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-2 [overflow-wrap:anywhere] [scrollbar-gutter:stable]">
				{!state && !model.error && (
					<p role="status" className="text-[12px] text-muted-foreground">
						{t(hasSession ? "contextWorkspace.loading" : "contextWorkspace.noSession")}
					</p>
				)}
				{state && (
					<>
						<details open={model.pinned.length > 0} className="rounded-lg border border-border p-3">
							<summary className="cursor-pointer text-[13px] font-medium">
								{t("contextWorkspace.pinned")}
							</summary>
							<textarea
								aria-label={t("contextWorkspace.pinned")}
								className="mt-3 min-h-24 w-full resize-y rounded-lg border border-border bg-background p-3 text-[13px]"
								maxLength={16000}
								value={model.pinned}
								onChange={(event) => model.setPinned(event.target.value)}
								disabled={disabled}
							/>
						</details>
						{(state.summary || state.previousSummary) && (
							<details className="rounded-lg border border-border p-3">
								<summary className="cursor-pointer text-[13px]">{t("contextWorkspace.summary")}</summary>
								<p className="mt-2 whitespace-pre-wrap text-[12px]">{state.summary}</p>
								{state.previousSummary && (
									<>
										<h3 className="mt-3 text-[12px] font-medium">{t("contextWorkspace.previous")}</h3>
										<p className="mt-2 whitespace-pre-wrap text-[12px] text-muted-foreground">
											{state.previousSummary}
										</p>
									</>
								)}
							</details>
						)}
						<p className="text-[11px] text-muted-foreground">
							{t("contextWorkspace.turns", { count: state.totalTurns })}
						</p>
						<div className="divide-y divide-border/40">
							{turns.map((turn) => (
								<div
									key={turn.id}
									className={`flex min-w-0 gap-3 py-3 ${model.excluded.includes(turn.id) ? "opacity-60" : ""}`}
								>
									<input
										type="checkbox"
										className="mt-1 h-4 w-4 shrink-0 accent-primary"
										aria-label={turn.text.slice(0, 80) || t("contextWorkspace.attachmentTurn")}
										checked={!model.excluded.includes(turn.id)}
										disabled={disabled}
										onChange={(event) => {
											const current = turns.findIndex((entry) => entry.id === turn.id);
											const start = turns.findIndex((entry) => entry.id === anchor);
											const shift = "shiftKey" in event.nativeEvent && event.nativeEvent.shiftKey === true;
											model.setIncluded(
												shift && start >= 0
													? turns
															.slice(Math.min(start, current), Math.max(start, current) + 1)
															.map((entry) => entry.id)
													: [turn.id],
												event.target.checked,
											);
											setAnchor(turn.id);
										}}
									/>
									<div className="min-w-0 flex-1">
										<span className="mb-1 block text-[11px] text-muted-foreground">
											{t(
												`contextWorkspace.${model.excluded.includes(turn.id) ? "excluded" : turn.status === "summarized" ? "summarized" : "included"}`,
											)}
										</span>
										<details className="text-[13px]">
											<summary className="cursor-pointer whitespace-pre-wrap">
												{turn.text.slice(0, 200) || t("contextWorkspace.attachmentTurn")}
											</summary>
											<p className="mt-2 whitespace-pre-wrap">{turn.text}</p>
										</details>
										<Button
											size="xs"
											variant="ghost"
											disabled={
												disabled ||
												!turn.text ||
												model.pinned.includes(turn.text) ||
												model.pinned.length + turn.text.length + 2 > 16000
											}
											onClick={() => model.setPinned([model.pinned, turn.text].filter(Boolean).join("\n\n"))}
										>
											{t("contextWorkspace.pinPreview")}
										</Button>
										{turn.attachments.map((path) => (
											<span key={path} className="mt-1 block text-[11px] text-muted-foreground">
												{path}
											</span>
										))}
									</div>
								</div>
							))}
						</div>
						{turns.length === 0 && (
							<p className="py-4 text-center text-[12px] text-muted-foreground">{t("workbench.noMatches")}</p>
						)}
					</>
				)}
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border pt-3">
				<p
					role={model.error ? "alert" : "status"}
					className={`mr-auto min-w-0 flex-1 text-[12px] ${model.error ? "text-destructive" : "text-muted-foreground"}`}
				>
					{model.error
						? t("contextWorkspace.failed")
						: model.dirty
							? t("contextWorkspace.unsaved")
							: model.saved
								? t("contextWorkspace.saved")
								: ""}
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
