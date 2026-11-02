import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@vetta-org/ui";
import type { JSX } from "react";
import { ReleaseNoteMarkdown } from "./ReleaseNoteMarkdown";
import { parseReleaseNote } from "./release-note";
import { MotionSelect } from "../settings/MotionSelect";

export interface UpdateReleaseHistoryViewProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	loading: boolean;
	error: string;
	range: string;
	ranges: { value: string; label: string }[];
	onRangeChange: (range: string) => void;
	releases: { version: string; body: string; url: string; status: string; statusKind?: "available" | "current" }[];
	labels: Record<
		"title" | "description" | "range" | "loading" | "empty" | "missing" | "retry" | "releasePage",
		string
	>;
	onRetry: () => void;
	releasePageUrl: string;
	onOpenUrl: (url: string) => void;
}

export function UpdateReleaseHistoryView({
	open,
	onOpenChange,
	loading,
	error,
	range,
	ranges,
	onRangeChange,
	releases,
	labels,
	onRetry,
	onOpenUrl,
	releasePageUrl,
}: UpdateReleaseHistoryViewProps): JSX.Element {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[85vh] min-w-0 flex-col sm:max-w-[680px]">
				<DialogHeader className="pr-6">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<DialogTitle>{labels.title}</DialogTitle>
						<MotionSelect
							aria-label={labels.range}
							value={range}
							options={ranges}
							onValueChange={onRangeChange}
						/>
					</div>
					<DialogDescription>{labels.description}</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 overflow-y-auto" aria-busy={loading}>
					{loading && <output className="py-4 text-[13px] text-muted-foreground">{labels.loading}</output>}
					{error && (
						<div role="alert" className="space-y-2 py-4 text-[13px] text-destructive">
							<p>{error}</p>
							<Button size="sm" variant="outline" onClick={onRetry}>
								{labels.retry}
							</Button>
							<Button size="sm" variant="ghost" onClick={() => onOpenUrl(releasePageUrl)}>
								{labels.releasePage}
							</Button>
						</div>
					)}
					{!loading && !error && releases.length === 0 && (
						<div className="space-y-2 py-4 text-[13px] text-muted-foreground">
							<p>{labels.empty}</p>
							<Button size="sm" variant="ghost" onClick={() => onOpenUrl(releasePageUrl)}>
								{labels.releasePage}
							</Button>
						</div>
					)}
					{!loading &&
						!error &&
						releases.map((release) => {
							const note = parseReleaseNote(release.body, release.version);
							return (
								<article
									key={release.version}
									className="space-y-3 border-b border-border py-4 last:border-b-0"
								>
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
											<h3 className="text-[14px] font-semibold">v{release.version}</h3>
											{note.date && (
												<time
													dateTime={note.date}
													className="text-[12px] font-normal tabular-nums text-muted-foreground"
												>
													{note.date}
												</time>
											)}
											{release.status && (
												<span
													className={`rounded-md border px-1.5 py-0.5 text-[11px] font-normal ${release.statusKind === "available" ? "border-amber-500/30 bg-amber-500/15 text-foreground" : "border-border bg-muted text-muted-foreground"}`}
												>
													{release.status}
												</span>
											)}
										</div>
										<Button size="sm" variant="ghost" onClick={() => onOpenUrl(release.url)}>
											{labels.releasePage}
										</Button>
									</div>
									{release.body ? (
										<ReleaseNoteMarkdown body={note.body} onOpenUrl={onOpenUrl} />
									) : (
										<p className="text-[13px] text-muted-foreground">{labels.missing}</p>
									)}
								</article>
							);
						})}
				</div>
			</DialogContent>
		</Dialog>
	);
}
