import { Button } from "@vetta-org/ui";
import { Progress } from "radix-ui";
import { type JSX, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SettingRow } from "../settings/SettingChrome";

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
	readonly phase: UpdateCheckerPhase;
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
			<span className={`icon-[mdi--refresh] h-3.5 w-3.5 ${checking ? "animate-spin" : ""}`} />
			{checking ? labels.checkingBtn : labels.check}
		</Button>
	);
}

/** Version-row actions preserve the existing check/download/restart callbacks. */
export function UpdateCheckerActions(
	props: Pick<UpdateCheckerViewProps, "checking" | "labels" | "onCheck" | "onPrimary" | "onPause" | "phase" | "currentVersion">,
): JSX.Element {
	return (
		<div className="flex flex-wrap items-center justify-end gap-3">
			<span className="text-[12px] tabular-nums text-muted-foreground">{props.currentVersion}</span>
			{props.phase === "downloading" && props.onPause && props.labels.pause ? (
				<Button size="sm" variant="outline" onClick={props.onPause}>{props.labels.pause}</Button>
			) : null}
			{props.phase === "available" || props.phase === "ready" ? (
				<Button size="sm" variant="outline" onClick={props.onPrimary}>
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
}: {
	readonly progress?: number;
	readonly label: string;
}): JSX.Element {
	const percent = Math.max(0, Math.min(100, (progress ?? 0) * 100));
	return (
		<Progress.Root
			value={percent}
			max={100}
			aria-label={label}
			className="h-1 w-full overflow-hidden rounded-full bg-muted"
		>
			<Progress.Indicator
				className="h-full w-full rounded-full bg-primary motion-safe:transition-transform motion-safe:duration-200"
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
	phase,
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
	| "phase"
	| "progress"
	| "downloadedBytes"
	| "totalBytes"
	| "releaseNote"
>): JSX.Element | null {
	if (phase !== "available" && phase !== "downloading" && phase !== "ready") {
		return null;
	}

	return (
		<div className="min-w-0 space-y-2" data-testid="updater-detail" data-updater-phase={phase}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="min-w-0">
					<span className="text-[13px] font-medium text-foreground">{labels.newVersion(latestVersion ?? "")}</span>
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
						<span>{labels.downloading(Math.round((progress ?? 0) * 100))}</span>
						{typeof downloadedBytes === "number" &&
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
						label={labels.downloading(Math.round((progress ?? 0) * 100))}
					/>
				</div>
			)}
			{releaseNote && (
				<ReleaseNotePreview
					releaseNote={releaseNote}
					viewMoreLabel={labels.viewMore ?? "View more"}
					onViewMore={onViewMore}
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
}: {
	readonly releaseNote: string;
	readonly viewMoreLabel: string;
	readonly onViewMore?: () => void;
}): JSX.Element {
	const contentRef = useRef<HTMLDivElement>(null);
	const [isOverflowing, setIsOverflowing] = useState(false);
	const formattedNote = useMemo(() => htmlToMarkdown(releaseNote), [releaseNote]);

	useEffect(() => {
		const el = contentRef.current;
		if (!el) return;

		// 检查纯行数（通过换行统计作为下限）以及实际渲染像素高度
		const lineCount = formattedNote.split(/\r?\n/).length;
		if (lineCount > MAX_LINES || el.scrollHeight > MAX_HEIGHT_PX + 4) {
			setIsOverflowing(true);
		} else {
			setIsOverflowing(false);
		}
	}, [formattedNote]);

	return (
		<div className="relative mt-2">
			<div
				ref={contentRef}
				className={`markdown-body text-[12.5px] leading-[1.5] text-muted-foreground break-words ${
					isOverflowing ? "overflow-hidden" : ""
				}`}
				style={isOverflowing ? { maxHeight: `${MAX_HEIGHT_PX}px` } : undefined}
			>
				<ReactMarkdown remarkPlugins={[remarkGfm]}>{formattedNote}</ReactMarkdown>
			</div>
			{isOverflowing && (
				<div className="pt-6 -mt-6 bg-gradient-to-t from-secondary via-secondary/85 to-transparent flex items-center justify-center relative z-10">
					<button
						type="button"
						onClick={onViewMore}
						className="cursor-pointer inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline py-1 px-2 rounded hover:bg-muted/50 transition-colors"
					>
						<span>{viewMoreLabel}</span>
						<span className="icon-[mdi--chevron-right] h-3.5 w-3.5" />
					</button>
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
						label={props.labels.downloading(Math.round((props.progress ?? 0) * 100))}
					/>
				</div>
			)}
			{props.releaseNote && (
				<div className="px-4 pb-4">
					<ReleaseNotePreview
						releaseNote={props.releaseNote}
						viewMoreLabel={props.labels.viewMore ?? ""}
						onViewMore={props.onViewMore}
					/>
				</div>
			)}
		</div>
	);
}
