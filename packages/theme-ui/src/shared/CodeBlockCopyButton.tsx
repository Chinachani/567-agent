import { Button } from "@vetta-org/ui";
import type { JSX, MouseEvent, PointerEvent, ReactNode } from "react";

export interface CodeBlockCopyButtonLabels {
	copy: string;
	copied: string;
}

export interface CodeBlockCopyButtonViewProps {
	children: ReactNode;
	copied: boolean;
	onCopy: () => void;
	onPreview?: () => void;
	onSave?: () => void;
	savePending?: boolean;
	previewLabel?: string;
	saveLabel?: string;
	labels: CodeBlockCopyButtonLabels;
}

/** Props-driven copy chrome around a code block. Host owns clipboard state. */
export function CodeBlockCopyButtonView({
	children,
	copied,
	onCopy,
	labels,
	onPreview,
	onSave,
	savePending,
	previewLabel,
	saveLabel,
}: CodeBlockCopyButtonViewProps): JSX.Element {
	function stopMessageDrag(event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>): void {
		event.preventDefault();
		event.stopPropagation();
	}

	function handleCopy(event: MouseEvent<HTMLButtonElement>): void {
		stopMessageDrag(event);
		onCopy();
	}

	return (
		<div className="group/code-block relative">
			<div className="absolute right-2 top-2 z-20 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/code-block:opacity-100">
				{onPreview && (
					<Button
						variant="ghost"
						size="icon-xs"
						title={previewLabel}
						aria-label={previewLabel}
						onClick={(event) => {
							stopMessageDrag(event);
							onPreview();
						}}
					>
						<span className="icon-[solar--sidebar-minimalistic-linear] size-4" />
					</Button>
				)}
				{onSave && (
					<Button
						variant="ghost"
						size="icon-xs"
						disabled={savePending}
						title={saveLabel}
						aria-label={saveLabel}
						onClick={(event) => {
							stopMessageDrag(event);
							onSave();
						}}
					>
						<span className="icon-[solar--download-linear] size-4" />
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon-xs"
					type="button"
					onPointerDown={stopMessageDrag}
					onMouseDown={stopMessageDrag}
					onClick={handleCopy}
					aria-label={copied ? labels.copied : labels.copy}
					title={copied ? labels.copied : labels.copy}
					className="bg-muted/95"
				>
					<span className={copied ? "icon-[mdi--check] h-4 w-4" : "icon-[solar--copy-linear] h-4 w-4"} />
				</Button>
			</div>
			{children}
		</div>
	);
}
