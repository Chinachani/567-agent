import { ContextMenu } from "radix-ui";
import type { ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import { useMarkdownHost } from "./host";
import type { MarkdownLabels } from "./rich-labels";

/** File and URL actions share the same menu and keyboard/focus behavior. Host owns every side effect. */
export function ResourceMenu({
	kind,
	target,
	open,
	labels,
	children,
}: {
	kind: "file" | "url";
	target: string;
	open: () => void;
	labels: MarkdownLabels;
	children: ReactElement;
}) {
	const host = useMarkdownHost();
	const [failedTarget, setFailedTarget] = useState<string | null>(null);
	const generation = useRef(0);
	useEffect(
		() => () => {
			generation.current++;
		},
		[target, kind],
	);
	const words = labels.resources ?? {
		openFile: "Open file",
		openUrl: "Open in default browser",
		copyFile: "Copy path",
		copyUrl: "Copy link",
		revealFile: "Show in file manager",
		failed: "Could not complete this action. Try again.",
	};
	const action = (run: () => void | Promise<void>) => {
		const current = generation.current;
		setFailedTarget(null);
		void Promise.resolve()
			.then(run)
			.catch(() => {
				if (current === generation.current) setFailedTarget(target);
			});
	};
	if (kind === "url" && !host?.openExternalUrl && !host?.copyText) return children;
	const itemClass =
		"flex cursor-default select-none items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-hidden transition-colors data-highlighted:bg-accent/60";
	return (
		<>
			<ContextMenu.Root>
				<ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
				<ContextMenu.Portal>
					<ContextMenu.Content
						className="no-drag z-50 min-w-44 max-w-[calc(100vw-1rem)] overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md"
						collisionPadding={8}
					>
						{(kind === "file" || host?.openExternalUrl) && (
							<ContextMenu.Item
								className={itemClass}
								onSelect={() =>
									action(kind === "url" && host?.openExternalUrl ? () => host.openExternalUrl?.(target) : open)
								}
							>
								<span
									aria-hidden
									className={`${kind === "file" ? "icon-[solar--document-linear]" : "icon-[solar--global-linear]"} h-3.5 w-3.5 text-muted-foreground`}
								/>
								{kind === "file" ? words.openFile : words.openUrl}
							</ContextMenu.Item>
						)}
						{host?.revealFile && kind === "file" && (
							<ContextMenu.Item className={itemClass} onSelect={() => action(() => host.revealFile?.(target))}>
								<span
									aria-hidden
									className="icon-[solar--folder-open-linear] h-3.5 w-3.5 text-muted-foreground"
								/>
								{words.revealFile}
							</ContextMenu.Item>
						)}
						{host?.copyText && (
							<>
								<ContextMenu.Separator className="my-1 h-px bg-border" />
								<ContextMenu.Item
									className={itemClass}
									onSelect={() => action(() => host.copyText?.(target, kind))}
								>
									<span aria-hidden className="icon-[solar--copy-linear] h-3.5 w-3.5 text-muted-foreground" />
									{kind === "file" ? words.copyFile : words.copyUrl}
								</ContextMenu.Item>
							</>
						)}
					</ContextMenu.Content>
				</ContextMenu.Portal>
			</ContextMenu.Root>
			{failedTarget === target && (
				<span role="status" className="text-[12px] text-destructive">
					{words.failed}
				</span>
			)}
		</>
	);
}
