import type { JSX, ReactNode } from "react";
import { cn } from "@vetta-org/ui";

export interface WorkspacePageHeaderProps {
	readonly title: ReactNode;
	readonly description?: ReactNode;
	readonly actions?: ReactNode;
	readonly className?: string;
}

/** A wrapping page heading; the host keeps ownership of actions and copy. */
export function WorkspacePageHeader({ title, description, actions, className }: WorkspacePageHeaderProps): JSX.Element {
	return (
		<header className={cn("flex min-w-0 flex-wrap items-start justify-between gap-x-5 gap-y-3", className)}>
			<div className="min-w-0 flex-1 basis-64">
				<h1 className="break-words text-[22px] font-semibold leading-tight sm:text-[26px] tracking-tight text-foreground">
					{title}
				</h1>
				{description && (
					<p className="mt-1.5 max-w-prose whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
						{description}
					</p>
				)}
			</div>
			{actions && <div className="no-drag flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
		</header>
	);
}
