import type { JSX, ReactNode } from "react";
import { WorkspacePageHeader } from "../shared/WorkspacePageHeader";

export interface SettingsPageShellViewProps {
	readonly title: string;
	readonly description?: string;
	readonly headerAction?: ReactNode;
	readonly loading?: boolean;
	readonly loadingLabel?: string;
	readonly children?: ReactNode;
	readonly footer?: ReactNode;
	readonly pb?: boolean;
}

/** Shared settings tab page chrome; the heading stays visible during loading. */
export function SettingsPageShellView({
	title,
	description,
	headerAction,
	loading = false,
	loadingLabel,
	children,
	footer,
	pb = false,
}: SettingsPageShellViewProps): JSX.Element {
	return (
		<div className={`mx-auto w-full max-w-[800px] px-5 pt-6 sm:px-8 ${pb ? "pb-12" : "pb-8"}`}>
			<WorkspacePageHeader
				title={title}
				description={description}
				actions={loading ? undefined : headerAction}
				className="mb-8 border-b border-border/60 pb-6"
			/>
			{loading ? (
				<div role="status" className="flex items-center gap-3 py-10 text-[13px] text-muted-foreground">
					<span aria-hidden className="icon-[solar--refresh-linear] h-4 w-4 animate-spin" />
					{loadingLabel}
				</div>
			) : (
				<>
					{children}
					{footer}
				</>
			)}
		</div>
	);
}
