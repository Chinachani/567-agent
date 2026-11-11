import { Button } from "@vetta-org/ui";
import { Progress } from "radix-ui";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import { ReleaseNoteMarkdown } from "./ReleaseNoteMarkdown";
import { parseReleaseNote } from "./release-note";
import { SettingRow } from "../settings/SettingChrome";
import { FadingScrollArea } from "../chat/FadingScrollArea";

export interface UpdateCheckerViewLabels {
	readonly version?: string;
	readonly check: string;
	readonly checking: string;
	readonly transferred?: (downloaded: string, total: string) => string;
	readonly checkingBtn: string;
	readonly currentVersion: (version: string) => string;
	readonly download: string;
	readonly pause?: string;
	readonly downloading: (progress: number) => string;
	readonly preparing?: string;
	readonly idle: (version: string) => string;
	readonly newVersion: (version: string) => string;
	readonly restart: string;
	readonly viewMore?: string;
}

export type UpdateCheckerPhase = "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";

export interface UpdateCheckerViewProps {
	readonly checking: boolean;
	readonly currentVersion: string;
	readonly labels: UpdateCheckerViewLabels;
	readonly latestVersion?: string;
	readonly onCheck: () => void;
	readonly onPrimary: () => void;
	readonly onPause?: () => void;
	readonly onViewMore?: () => void;
	readonly onOpenUrl?: (url: string) => void;
	readonly phase: UpdateCheckerPhase;
	/** Local unpacking/staging after the network transfer; disk activity is expected. */
	readonly preparing?: boolean;
	readonly progress?: number;
	readonly downloadedBytes?: number;
	readonly totalBytes?: number;
	readonly releaseNote?: string;
	readonly statusText: string;
}

/** Settings 行右侧：与 App 引导同款 outline sm 按钮。 */
export function UpdateCheckerAction({
	checking,
	labels,
	onCheck,
	phase,
}: Pick<UpdateCheckerViewProps, "checking" | "labels" | "onCheck" | "phase">): JSX.Element {
	return (
		<Button
			size="sm"
			variant="outline"
			onClick={onCheck}
			disabled={checking || phase === "downloading" || phase === "ready" || phase === "installing"}
			data-testid="updater-check"
			data-updater-phase={phase}
		>
			<span
				aria-hidden="true"
				className={`icon-[solar--refresh-linear] h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`}
			/>
			{checking ? labels.checkingBtn : labels.check}
		</Button>
	);
}

/** Version-row actions preserve the existing check/download/restart callbacks. */
export function UpdateCheckerActions(
	props: Pick<
		UpdateCheckerViewProps,
		"checking" | "labels" | "onCheck" | "onPrimary" | "onPause" | "phase" | "currentVersion"
	>,
): JSX.Element {
	return (
		<div className="flex flex-wrap items-center justify-end gap-3">
			<span className="text-[12px] tabular-nums text-muted-foreground">{props.currentVersion}</span>
			{props.phase === "downloading" && props.onPause && props.labels.pause ? (
				<Button size="sm" variant="outline" onClick={props.onPause}>
					{props.labels.pause}
				</Button>
			) : null}
			{props.phase === "available" || props.phase === "ready" ? (
				<Button size="sm" variant={props.phase === "ready" ? "primary" : "outline"} onClick={props.onPrimary}>
					{props.phase === "ready" ? props.labels.restart : props.labels.download}
				</Button>
			) : props.phase !== "downloading" && props.phase !== "installing" ? (
				<UpdateCheckerAction {...props} />
			) : null}
		</div>
	);
}

export function UpdateDownloadProgress({
	progress,
	label,
	busy = false,
}: {
	readonly progress?: number;
	readonly label: string;
	readonly busy?: boolean;
}): JSX.Element {
	const percent = Math.max(0, Math.min(100, (progress ?? 0) * 100));
	return (
		<Progress.Root
			value={percent}
			max={100}
			aria-label={label}
			aria-busy={busy || undefined}
			className="h-1 w-full overflow-hidden rounded-full bg-muted"
		>
			<Progress.Indicator
				className={`h-full w-full rounded-full bg-primary motion-safe:transition-transform motion-safe:duration-200 ${busy ? "motion-safe:animate-pulse" : ""}`}
				style={{ transform: `translateX(-${100 - percent}%)` }}
			/>
		</Progress.Root>
	);
}

/** 有新版本时的详情卡片（放在 SettingRow 下方全宽）。 */
export function UpdateCheckerDetail({
	currentVersion,
	labels,
	latestVersion,
	onPrimary,
	onViewMore,
	onOpenUrl,
	phase,
	preparing,
	progress,
	downloadedBytes,
	totalBytes,
	releaseNote,
}: Pick<
	UpdateCheckerViewProps,
	| "currentVersion"
	| "labels"
	| "latestVersion"
	| "onPrimary"
	| "onViewMore"
	| "onOpenUrl"
	| "phase"
	| "preparing"
	| "progress"
	| "downloadedBytes"
	| "totalBytes"
	| "releaseNote"
>): JSX.Element | null {
	if (phase !== "available" && phase !== "downloading" && phase !== "ready") {
		return null;
	}

	const releaseDate = parseReleaseNote(htmlToMarkdown(releaseNote ?? ""), latestVersion).date;

	return (
		<div className="min-w-0 space-y-2" data-testid="updater-detail" data-updater-phase={phase}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<span className="text-[13px] font-medium text-foreground">{labels.newVersion(latestVersion ?? "")}</span>
					{releaseDate && (
						<time dateTime={releaseDate} className="ml-2 text-[12px] tabular-nums text-muted-foreground">
							{releaseDate}
						</time>
					)}
					<span className="ml-2 text-[12px] text-muted-foreground">{labels.currentVersion(currentVersion)}</span>
				</div>
				{phase === "available" && (
					<Button size="sm" variant="primary" onClick={onPrimary} data-testid="updater-primary">
						{labels.download}
					</Button>
				)}
				{phase === "ready" && (
					<Button size="sm" variant="primary" onClick={onPrimary} data-testid="updater-primary">
						{labels.restart}
					</Button>
				)}
			</div>
			{phase === "downloading" && (
				<div className="space-y-2">
					<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
						<span>
							{preparing && labels.preparing
								? labels.preparing
								: labels.downloading(Math.round((progress ?? 0) * 100))}
						</span>
						{!preparing &&
							typeof downloadedBytes === "number" &&
							typeof totalBytes === "number" &&
							totalBytes > 0 &&
							labels.transferred && (
								<span>
									{labels.transferred(
										(downloadedBytes / 1_000_000).toFixed(1),
										(totalBytes / 1_000_000).toFixed(1),
									)}
								</span>
							)}
					</div>
					<UpdateDownloadProgress
						progress={progress}
						busy={preparing}
						label={
							preparing && labels.preparing
								? labels.preparing
								: labels.downloading(Math.round((progress ?? 0) * 100))
						}
					/>
				</div>
			)}
			{releaseNote && (
				<ReleaseNotePreview
					releaseNote={releaseNote}
					viewMoreLabel={labels.viewMore ?? "View more"}
					onViewMore={onViewMore}
					onOpenUrl={onOpenUrl}
					showDate={false}
				/>
			)}
		</div>
	);
}

const MAX_LINES = 10;
// Line height ~1.5rem (24px) for 13px font text, 10 lines is ~240px
const MAX_HEIGHT_PX = 240;

function htmlToMarkdown(html: string): string {
	if (!html || !/<[a-z][\s\S]*>/i.test(html)) return html;
	let md = html;
	md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n");
	md = md.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n");
	md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n");
	md = md.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n");
	md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
	md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
	md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
	md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
	md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
	md = md.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
	md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");
	md = md.replace(/<br\s*\/?>/gi, "\n");
	md = md.replace(/<[^>]+>/g, "");
	md = md
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");
	return md.replace(/\n{3,}/g, "\n\n").trim();
}

function ReleaseNotePreview({
	releaseNote,
	viewMoreLabel,
	onViewMore,
	onOpenUrl,
	showDate = true,
}: {
	readonly releaseNote: string;
	readonly viewMoreLabel: string;
	readonly onViewMore?: () => void;
	readonly onOpenUrl?: (url: string) => void;
	readonly showDate?: boolean;
}): JSX.Element {
	const contentRef = useRef<HTMLDivElement>(null);
	const [isOverflowing, setIsOverflowing] = useState(false);
	const note = useMemo(() => parseReleaseNote(htmlToMarkdown(releaseNote)), [releaseNote]);
	const formattedNote = note.body;
	const compact = isOverflowing && Boolean(onViewMore && viewMoreLabel.trim());

	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;

		const sync = () => {
			// The inner content remains measurable while the preview is height-limited.
			const lineCount = formattedNote.split(/\r?\n/).length;
			setIsOverflowing(lineCount > MAX_LINES || el.scrollHeight > MAX_HEIGHT_PX + 4);
		};
		sync();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(sync);
		observer.observe(el);
		return () => observer.disconnect();
	}, [formattedNote]);

	return (
		<div className="mt-2 min-w-0">
			<FadingScrollArea
				className="break-words text-[13px] leading-relaxed text-muted-foreground"
				style={compact ? { maxHeight: MAX_HEIGHT_PX } : undefined}
			>
				<div ref={contentRef}>
					{showDate && note.date && (
						<time dateTime={note.date} className="mb-2 block text-[11px] tabular-nums text-muted-foreground">
							{note.date}
						</time>
					)}
					<ReleaseNoteMarkdown body={formattedNote} onOpenUrl={onOpenUrl} />
				</div>
			</FadingScrollArea>
			{compact && (
				<div className="mt-2 flex justify-start">
					<Button variant="ghost" size="xs" onClick={onViewMore}>
						<span>{viewMoreLabel}</span>
						<span aria-hidden="true" className="icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5" />
					</Button>
				</div>
			)}
		</div>
	);
}

/** 独立使用时：动作 + 详情纵向排列。设置页请用 Action / Detail 配合 SettingRow。 */
export function UpdateCheckerView(props: UpdateCheckerViewProps): JSX.Element {
	return (
		<div className="min-w-0 border-b border-border">
			<SettingRow
				title={props.labels.version ?? props.labels.currentVersion(props.currentVersion)}
				description={props.statusText || undefined}
				border={false}
			>
				<UpdateCheckerActions {...props} />
			</SettingRow>
			{props.phase === "downloading" && (
				<div className="px-4 pb-4">
					<UpdateDownloadProgress
						progress={props.progress}
						busy={props.preparing}
						label={
							props.preparing && props.labels.preparing
								? props.labels.preparing
								: props.labels.downloading(Math.round((props.progress ?? 0) * 100))
						}
					/>
				</div>
			)}
			{props.releaseNote && (
				<div className="px-4 pb-4">
					<ReleaseNotePreview
						releaseNote={props.releaseNote}
						viewMoreLabel={props.labels.viewMore ?? ""}
						onViewMore={props.onViewMore}
						onOpenUrl={props.onOpenUrl}
					/>
				</div>
			)}
		</div>
	);
}
