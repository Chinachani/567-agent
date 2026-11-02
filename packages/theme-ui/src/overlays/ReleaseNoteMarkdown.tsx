import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Update notes share typography and deliberately omit remote images and raw HTML. */
export function ReleaseNoteMarkdown({ body, onOpenUrl }: { body: string; onOpenUrl?: (url: string) => void }) {
	return (
		<div className="min-w-0 break-words text-[13px]">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
				components={{
					img: () => null,
					h1: ({ children }) => (
						<h2 className="mb-2 mt-4 text-[14px] font-semibold text-foreground first:mt-0">{children}</h2>
					),
					h2: ({ children }) => (
						<h2 className="mb-2 mt-4 text-[13px] font-semibold text-foreground first:mt-0">{children}</h2>
					),
					h3: ({ children }) => (
						<h3 className="mb-2 mt-4 text-[13px] font-semibold text-foreground first:mt-0">{children}</h3>
					),
					ul: ({ children }) => (
						<ul className="my-1.5 list-disc space-y-1.5 pl-5 text-muted-foreground">{children}</ul>
					),
					ol: ({ children, start }) => (
						<ol start={start} className="my-1.5 list-decimal space-y-1.5 pl-5 text-muted-foreground">
							{children}
						</ol>
					),
					li: ({ children }) => (
						<li className="text-[13px] leading-relaxed text-foreground/80 marker:text-muted-foreground/60">
							{children}
						</li>
					),
					p: ({ children }) => <p className="my-1.5 leading-relaxed text-muted-foreground">{children}</p>,
					code: ({ children }) => (
						<code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>
					),
					pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-3">{children}</pre>,
					a: ({ href, children }) => (
						<a
							href={href}
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary underline underline-offset-2"
							onClick={(event) => {
								if (onOpenUrl || !href) {
									event.preventDefault();
									if (href) onOpenUrl?.(href);
								}
							}}
						>
							{children}
						</a>
					),
				}}
			>
				{body}
			</ReactMarkdown>
		</div>
	);
}
