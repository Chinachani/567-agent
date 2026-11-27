import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import { attachedImagesAtom, filePreviewAtom, mentionedFilesAtom } from "@shared/store/atoms";
import { useAtom, useSetAtom } from "jotai";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionWorkbenchModel } from "../hooks/useSessionWorkbench";
import { AttachmentThumbnail } from "./AttachmentThumbnail";
import { formatDurationCompact } from "./blocks/tool-views/shared/format";
import { reviewBadgeClass, SessionAssetDetail, taskBadgeClass } from "./SessionAssetDetail";

type PendingSelection = { kind: "file" | "image"; id: string } | null;
export function SessionAssetsPanel({
	model,
	section,
}: {
	model: SessionWorkbenchModel;
	section: "attachment" | "task" | "change";
}): JSX.Element {
	const { t } = useTranslation("chat");
	const readScopeId = useId();
	const [pendingFiles, setPendingFiles] = useAtom(mentionedFilesAtom);
	const [pendingImages, setPendingImages] = useAtom(attachedImagesAtom);
	const preview = useSetAtom(filePreviewAtom);
	const [query, setQuery] = useState("");
	const [pending, setPending] = useState<PendingSelection>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const pendingFile = pending?.kind === "file" ? pendingFiles.find((file) => file.path === pending.id) : undefined;
	const pendingImage = pending?.kind === "image" ? pendingImages.find((image) => image.id === pending.id) : undefined;
	const hasDetail = !!(
		pendingFile ||
		pendingImage ||
		(selectedId && (model.detail?.kind === section || model.busy || model.error))
	);
	const matches = (value: string) => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
	const attachments = model.snapshot?.attachments.filter((file) => matches(`${file.name}\n${file.path}`)) ?? [];
	const tasks = model.snapshot?.tasks.filter((task) => matches(task.title)) ?? [];
	const changes = model.snapshot?.changes.filter((change) => matches(change.path)) ?? [];
	const queuedFiles = pendingFiles.filter((file) => matches(`${file.name}\n${file.path}`));
	const queuedImages = pendingImages.filter((image) => matches(image.name));
	const empty =
		section === "attachment"
			? attachments.length + queuedFiles.length + queuedImages.length === 0
			: section === "task"
				? tasks.length === 0
				: changes.length === 0;
	const close = () => {
		setPending(null);
		setSelectedId(null);
		model.clearDetail();
	};
	const select = (id: string) => {
		setPending(null);
		setSelectedId(id);
		void model.select(section, id);
	};
	const selectPending = (kind: "file" | "image", id: string) => {
		model.clearDetail();
		setSelectedId(null);
		setPending({ kind, id });
	};
	const selectedTask =
		section === "task" && selectedId ? model.snapshot?.tasks.find((task) => task.id === selectedId) : undefined;
	const selectedChange =
		section === "change" && selectedId
			? model.snapshot?.changes.find((change) => change.id === selectedId)
			: undefined;
	const rowClass =
		"h-16 w-full min-w-0 justify-start gap-2 whitespace-normal px-3 text-left aria-pressed:bg-accent/60";
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
			<div className="flex shrink-0 gap-2">
				<div className="relative min-w-0 flex-1">
					<Input
						aria-label={t("workbench.search")}
						placeholder={t("workbench.search")}
						className={`w-full text-[12px] ${query.length > 0 ? "pr-8" : ""}`}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					{query.length > 0 && (
						<Button
							size="icon-xs"
							variant="ghost"
							aria-label={t("workbench.clearSearch")}
							className="absolute top-1/2 right-1 -translate-y-1/2"
							onClick={() => setQuery("")}
						>
							<span className="icon-[solar--close-circle-linear] h-3.5 w-3.5" aria-hidden="true" />
						</Button>
					)}
				</div>
				<Button
					size="sm"
					variant="ghost"
					disabled={model.busy}
					onClick={() => {
						close();
						void model.refresh();
					}}
				>
					{t("workbench.refresh")}
				</Button>
			</div>
			<p className="shrink-0 text-[11px] text-muted-foreground">{t(`workbench.${section}Hint`)}</p>
			{model.error && (
				<p role="alert" className="shrink-0 text-[12px] text-destructive">
					{t("workbench.failed")}
				</p>
			)}
			<div
				className={`grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden ${hasDetail ? "md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : "grid-cols-1"}`}
			>
				<div
					className={`min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-xl border border-border/50 bg-card/20 [scrollbar-gutter:stable] ${hasDetail ? "hidden md:block" : ""}`}
				>
					{model.busy && !selectedId && (
						<p role="status" className="p-3 text-[12px] text-muted-foreground">
							{t("workbench.loading")}
						</p>
					)}
					{section === "attachment" && queuedFiles.length + queuedImages.length > 0 && (
						<div className="border-b border-border/60 bg-primary/5">
							<div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1">
								<h3 className="text-[11px] font-medium text-primary">{t("workbench.pending")}</h3>
								<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
									{t("workbench.draft")}
								</span>
							</div>
							{queuedImages.map((image) => (
								<Button
									key={image.id}
									variant="ghost"
									className={rowClass}
									disabled={model.reviewing}
									onClick={() => selectPending("image", image.id)}
									aria-pressed={pendingImage?.id === image.id}
								>
									<span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted/40">
										<img
											src={`data:${image.mimeType};base64,${image.data}`}
											alt={image.name}
											className="h-full w-full object-contain"
										/>
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[13px]">{image.name}</span>
										<span className="block truncate text-[11px] text-muted-foreground">
											{t("workbench.draftImage")}
										</span>
									</span>
								</Button>
							))}
							{queuedFiles.map((file) => (
								<Button
									key={file.path}
									variant="ghost"
									className={rowClass}
									disabled={model.reviewing}
									onClick={() => selectPending("file", file.path)}
									aria-pressed={pendingFile?.path === file.path}
								>
									<span className="icon-[solar--document-text-linear] h-4 w-4 shrink-0" aria-hidden="true" />
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[13px]">{file.name}</span>
										<span className="block truncate text-[11px] text-muted-foreground">{file.path}</span>
									</span>
									{file.readScope?.trim() && (
										<span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
											{t("workbench.draftScopeSet")}
										</span>
									)}
								</Button>
							))}
						</div>
					)}
					{section === "attachment" && attachments.length > 0 && (
						<div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-2">
							<h3 className="text-[11px] font-medium text-muted-foreground">
								{t("workbench.historyAttachments")}
							</h3>
							<div className="flex items-center gap-1.5">
								<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] tabular-nums text-muted-foreground">
									{t("workbench.itemCount", { count: attachments.length })}
								</span>
								<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
									{t("workbench.readOnlyDetail")}
								</span>
							</div>
						</div>
					)}
					<div className="divide-y divide-border/40">
						{section === "attachment" &&
							attachments.map((file) => (
								<Button
									key={file.id}
									variant="ghost"
									className={rowClass}
									disabled={model.reviewing}
									onClick={() => select(file.id)}
									aria-pressed={selectedId === file.id}
								>
									{file.kind === "image" || /\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name) ? (
										<AttachmentThumbnail id={file.id} read={model.readThumbnail} />
									) : (
										<span
											className="icon-[solar--document-text-linear] h-4 w-4 shrink-0"
											aria-hidden="true"
										/>
									)}
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[13px]">{file.name}</span>
										<span className="block truncate text-[11px] text-muted-foreground">
											{t("workbench.originalStored")}
										</span>
									</span>
								</Button>
							))}
						{section === "task" &&
							tasks.map((task) => (
								<Button
									key={task.id}
									variant="ghost"
									className={rowClass}
									disabled={model.reviewing}
									onClick={() => select(task.id)}
									aria-pressed={selectedId === task.id}
								>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[13px]">
											{task.title || t("workbench.untitled")}
										</span>
										<span className="block truncate text-[11px] tabular-nums text-muted-foreground">
											{new Date(task.timestamp).toLocaleString()} ·{" "}
											{task.durationMs === null ? "—" : formatDurationCompact(task.durationMs)} ·{" "}
											{t("workbench.tools", { count: task.toolCount })}
										</span>
									</span>
									<span
										className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${taskBadgeClass(task.status)}`}
									>
										{t(`workbench.status.${task.status}`)}
									</span>
								</Button>
							))}
						{section === "change" &&
							changes.map((change) => (
								<Button
									key={change.id}
									variant="ghost"
									className={rowClass}
									disabled={model.reviewing}
									onClick={() => select(change.id)}
									aria-pressed={selectedId === change.id}
								>
									<span className="min-w-0 flex-1 truncate text-[13px]">{change.path || change.id}</span>
									<span className="flex shrink-0 items-center gap-1.5">
										{change.reversible && change.status !== "reverted" && (
											<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
												{t("workbench.reversible")}
											</span>
										)}
										<span
											className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${reviewBadgeClass(change.status)}`}
										>
											{t(`workbench.review.${change.status}`)}
										</span>
									</span>
								</Button>
							))}
					</div>
					{empty && !model.busy && (
						<div className="space-y-2 p-6 text-center">
							<p className="text-[12px] text-muted-foreground">
								{t(query ? "workbench.noMatches" : "workbench.empty")}
							</p>
							{query && (
								<Button size="xs" variant="outline" onClick={() => setQuery("")}>
									{t("workbench.clearSearch")}
								</Button>
							)}
						</div>
					)}
				</div>
				{hasDetail &&
					(pendingFile || pendingImage ? (
						<div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card/20">
							<div className="flex shrink-0 items-start gap-2 border-b border-border p-3">
								<h3 className="min-w-0 flex-1 break-all text-[13px] font-medium">
									{pendingFile?.name ?? pendingImage?.name}
								</h3>
								<Button size="xs" variant="ghost" className="shrink-0" onClick={close}>
									<span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5 md:hidden" aria-hidden="true" />
									{t("workbench.close")}
								</Button>
							</div>
							<div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4">
								<p className="text-[11px] text-primary">{t("workbench.draft")}</p>
								{pendingImage && (
									<>
										<p className="text-[11px] text-muted-foreground">{pendingImage.mimeType}</p>
										<img
											src={`data:${pendingImage.mimeType};base64,${pendingImage.data}`}
											alt={pendingImage.name}
											className="max-h-72 max-w-full rounded-lg border border-border/50 object-contain"
										/>
									</>
								)}
								{pendingFile && (
									<>
										<p className="break-all text-[11px] text-muted-foreground">{pendingFile.path}</p>
										<div className="space-y-2 text-[12px]">
											<div className="flex items-center justify-between gap-2">
												<label htmlFor={readScopeId}>{t("workbench.readScope")}</label>
												<div className="flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
													<span>
														{t("workbench.readScopeCount", { count: (pendingFile.readScope ?? "").length })}
													</span>
													{(pendingFile.readScope ?? "").length > 0 && (
														<Button
															size="xs"
															variant="ghost"
															onClick={() =>
																setPendingFiles((current) =>
																	current.map((file) =>
																		file.path === pendingFile.path ? { ...file, readScope: "" } : file,
																	),
																)
															}
														>
															{t("workbench.clearScope")}
														</Button>
													)}
												</div>
											</div>
											<Textarea
												id={readScopeId}
												className="min-h-24 w-full rounded-lg border border-border bg-background p-2 text-[13px]"
												maxLength={300}
												value={pendingFile.readScope ?? ""}
												onChange={(event) =>
													setPendingFiles((current) =>
														current.map((file) =>
															file.path === pendingFile.path
																? { ...file, readScope: event.target.value }
																: file,
														),
													)
												}
											/>
										</div>
									</>
								)}
							</div>
							<div className="flex shrink-0 flex-wrap gap-2 border-t border-border p-3">
								<Button
									size="sm"
									variant="outline"
									onClick={() => {
										if (pendingFile) preview({ path: pendingFile.path, name: pendingFile.name });
										if (pendingImage)
											preview({
												name: pendingImage.name,
												url: `data:${pendingImage.mimeType};base64,${pendingImage.data}`,
												mime: pendingImage.mimeType,
												kind: "image",
											});
									}}
								>
									{t("workbench.previewOriginal")}
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => {
										if (pendingFile)
											setPendingFiles((current) => current.filter((file) => file.path !== pendingFile.path));
										if (pendingImage)
											setPendingImages((current) => current.filter((image) => image.id !== pendingImage.id));
										close();
									}}
								>
									{t("workbench.remove")}
								</Button>
							</div>
						</div>
					) : (
						<SessionAssetDetail model={model} onClose={close} taskMeta={selectedTask} changeMeta={selectedChange} />
					))}
			</div>
		</div>
	);
}
