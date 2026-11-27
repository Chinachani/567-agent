import { forwardRef, useId, type JSX } from "react";
import { Button } from "@vetta-org/ui";
import { cn } from "@vetta-org/ui";

export interface MessageCenterTriggerViewProps {
	readonly open: boolean;
	readonly totalUnread: number;
	readonly title: string;
	readonly unreadLabel?: string;
	readonly onOpen: () => void;
}

export const MessageCenterTriggerView = forwardRef<HTMLButtonElement, MessageCenterTriggerViewProps>(
	function MessageCenterTriggerView({ open, totalUnread, title, unreadLabel, onOpen }, ref): JSX.Element {
		const unreadId = useId();
		const hasUnread = totalUnread > 0;
		const fullTitle = hasUnread && unreadLabel ? `${title} · ${unreadLabel}` : title;

		return (
			<Button
				ref={ref}
				type="button"
				variant="ghost"
				size="icon-sm"
				onClick={onOpen}
				className={cn("no-drag relative", open && "bg-accent text-foreground")}
				aria-label={title}
				aria-expanded={open}
				aria-haspopup="dialog"
				aria-describedby={hasUnread && unreadLabel ? unreadId : undefined}
				title={fullTitle}
			>
				<span
					aria-hidden="true"
					className={cn("inline-flex h-4 w-4 items-center justify-center", hasUnread && "message-bell-swing")}
				>
					<span className="icon-[solar--bell-linear] h-4 w-4" />
				</span>
				{hasUnread && (
					<span
						aria-hidden="true"
						className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground shadow-sm"
					>
						{totalUnread}
					</span>
				)}
				{hasUnread && unreadLabel ? (
					<span id={unreadId} className="sr-only">
						{unreadLabel}
					</span>
				) : null}
			</Button>
		);
	},
);
