import { cn } from "@vetta-org/ui";
import type { JSX } from "react";
import { AgentAvatarView } from "../chat/AgentAvatarView";

export interface AvatarStackViewProps {
	readonly avatarUrls: readonly string[];
	readonly className?: string;
}

const MAX_VISIBLE_AVATARS = 3;

/** Compact, decorative avatar stack for places where the adjacent label names the group. */
export function AvatarStackView({
	avatarUrls,
	className,
}: AvatarStackViewProps): JSX.Element {
	const visibleAvatarUrls = avatarUrls.slice(0, MAX_VISIBLE_AVATARS);
	const hiddenAvatarCount = avatarUrls.length - visibleAvatarUrls.length;
	return (
		<span
			className={cn("inline-flex shrink-0 items-center pl-0.5", className)}
			aria-hidden="true"
			data-avatar-stack="true"
		>
			{visibleAvatarUrls.map((avatarUrl, index) => (
				<AgentAvatarView key={`${avatarUrl}:${index}`} name="" size="xs" className={index > 0 ? "-ml-1.5" : undefined} />
			))}
			{hiddenAvatarCount > 0 ? (
				<span
					className="-ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[9px] tabular-nums text-muted-foreground ring-1 ring-background"
					data-avatar-overflow={hiddenAvatarCount}
				>
					+{hiddenAvatarCount}
				</span>
			) : null}
		</span>
	);
}
