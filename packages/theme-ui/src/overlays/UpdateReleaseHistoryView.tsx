import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@vetta-org/ui";
import type { JSX } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MotionSelect } from "../settings/MotionSelect";

export interface UpdateReleaseHistoryViewProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	loading: boolean;
	error: string;
	range: string;
	ranges: { value: string; label: string }[];
	onRangeChange: (range: string) => void;
	releases: { version: string; body: string; url: string; status: string }[];
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
				<DialogHeader>
					<DialogTitle>{labels.title}</DialogTitle>
					<DialogDescription>{labels.description}</DialogDescription>
				</DialogHeader>
				<MotionSelect aria-label={labels.range} value={range} options={ranges} onValueChange={onRangeChange} />
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
						releases.map((release) => (
							<article key={release.version} className="space-y-3 border-b border-border py-4 last:border-b-0">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<h3 className="text-[14px] font-semibold">
										v{release.version}{" "}
										<span className="text-[12px] font-normal text-muted-foreground">{release.status}</span>
									</h3>
									<Button size="sm" variant="ghost" onClick={() => onOpenUrl(release.url)}>
										{labels.releasePage}
									</Button>
								</div>
								{release.body ? (
									<div className="markdown-body break-words text-[13px]">
										<ReactMarkdown
											remarkPlugins={[remarkGfm]}
											urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
											components={{
												img: () => null,
												a: ({ href, children }) => (
													<a
														href={href}
														onClick={(event) => {
															event.preventDefault();
															if (href) onOpenUrl(href);
														}}
													>
														{children}
													</a>
												),
											}}
										>
											{release.body}
										</ReactMarkdown>
									</div>
								) : (
									<p className="text-[13px] text-muted-foreground">{labels.missing}</p>
								)}
							</article>
						))}
				</div>
			</DialogContent>
		</Dialog>
	);
}
