import { cn } from "@shared/lib/utils";
import { SidebarAccountMenu } from "./SidebarAccountMenu";
import { SidebarUpdateBanner } from "./update/SidebarUpdateBanner";

interface SidebarBottomBarProps {
	className?: string;
	classNames?: {
		settings?: string;
	};
}

/**
 * 侧栏底栏：更新提示与统一账号入口。
 */
export function SidebarBottomBar({ className, classNames }: SidebarBottomBarProps): JSX.Element {
	return (
		<div
			className={cn("relative flex min-w-0 shrink-0 flex-col gap-1 border-t border-border/60 px-2 py-2", className)}
		>
			<SidebarUpdateBanner />
			<SidebarAccountMenu className={classNames?.settings} />
		</div>
	);
}
