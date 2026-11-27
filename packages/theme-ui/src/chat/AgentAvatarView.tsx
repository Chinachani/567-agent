import { cn } from "@vetta-org/ui";
import type { JSX } from "react";

export interface AgentAvatarViewProps {
	readonly name: string;
	readonly avatar?: string;
	readonly active?: boolean;
	readonly size?: AgentAvatarSize;
	readonly className?: string;
}

export type AgentAvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "hero";

/** 尺寸 → [外框, 图标大小]。 */
const SIZE_CLASS: Record<AgentAvatarSize, string> = {
	xs: "h-4 w-4 [&>span]:size-2.5",
	sm: "h-5 w-5 [&>span]:size-3",
	md: "h-6 w-6 [&>span]:size-3.5",
	lg: "h-7 w-7 [&>span]:size-4",
	xl: "h-9 w-9 [&>span]:size-5",
	hero: "h-14 w-14 [&>span]:size-7",
};

/**
 * 全应用统一的 Agent 头像。使用单色底和小人图标，避免不同页面出现不同角色图和背景。
 * avatar 仍保留在公开 props 中以兼容旧调用方，产品界面不再渲染外部头像资源。
 */
export function AgentAvatarView({
	active = false,
	size = "md",
	className,
}: AgentAvatarViewProps): JSX.Element {
	return (
		<span
			aria-hidden="true"
			data-agent-avatar="true"
			className={cn(
				"inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-foreground ring-1 ring-border",
				active && "ring-primary/60",
				SIZE_CLASS[size],
				className,
			)}
		>
			<span aria-hidden="true" className="icon-[solar--user-rounded-linear]" />
		</span>
	);
}
