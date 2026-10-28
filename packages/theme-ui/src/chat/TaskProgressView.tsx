import type { ReactNode } from "react";

/** Layout parts keep task actions at the call site, so themes do not own recovery commands. */
export function TaskProgressView({ children }: { readonly children: ReactNode }) {
	return (
		<section className="w-full px-2 pb-2 pt-1 sm:px-4">
			<div className="mx-auto grid w-full max-w-2xl grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-border/50 px-1 pb-2">
				{children}
			</div>
		</section>
	);
}
export function TaskProgressStatus({
	title,
	elapsed,
	running,
	attention,
}: {
	readonly title: string;
	readonly elapsed?: string;
	readonly running: boolean;
	readonly attention: boolean;
}) {
	return (
		<div className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
			<output aria-live="polite" className="flex min-w-0 items-center gap-2 text-[12px] font-medium">
				<span
					aria-hidden
					className={`${running ? "icon-[solar--refresh-linear] motion-safe:animate-spin" : attention ? "icon-[solar--info-circle-linear]" : "icon-[solar--pause-circle-linear]"} h-3.5 w-3.5 shrink-0 ${attention ? "text-destructive" : "text-muted-foreground"}`}
				/>
				<span>{title}</span>
			</output>
			{elapsed ? (
				<span className="whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{elapsed}</span>
			) : null}
		</div>
	);
}
export function TaskProgressActions({ children }: { readonly children: ReactNode }) {
	return <div className="col-start-2 row-start-1 flex flex-wrap items-center justify-end gap-1">{children}</div>;
}
export function TaskProgressDetail({ text, objective }: { readonly text?: string; readonly objective?: string }) {
	return (
		<p
			className="col-start-1 row-start-2 min-w-0 truncate text-[12px] text-muted-foreground"
			title={[objective, text].filter(Boolean).join("\n")}
		>
			{objective || text}
		</p>
	);
}
export function TaskProgressLinks({ children }: { readonly children: ReactNode }) {
	return <div className="col-start-2 row-start-2 flex flex-wrap items-center justify-end gap-1">{children}</div>;
}
