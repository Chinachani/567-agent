import type { JSX, ReactNode } from "react";
import { Button, cn } from "@vetta-org/ui";
import { ImStatusBadgeView, type ImStatusBadgeStatus } from "./ImStatusBadgeView";

export type ImChannelCardDisplayMode = "status" | "pending" | "configured" | "unconfigured";

export interface ImChannelCardViewLabels {
	readonly channelActive: string;
	readonly channelConfigured: string;
	readonly channelNotAssociated: string;
	readonly channelPending?: string;
	readonly activateChannelTitle: string;
	/** 齿轮按钮的可访问名，按渠道不同（设置机器人 / 扫码绑定 / 配置渠道）。 */
	readonly configureLabel: string;
	readonly statusLabel: string;
}

/** 品牌图标资源，或缺资源时退回的单色图标类。 */
export type ImChannelCardIcon =
	| { readonly kind: "asset"; readonly url: string }
	| { readonly kind: "glyph"; readonly className: string };

export interface ImChannelCardViewProps {
	readonly name: string;
	readonly subtitle: string;
	readonly icon: ImChannelCardIcon;
	readonly configured: boolean;
	readonly isActive: boolean;
	readonly effectiveStatus: ImStatusBadgeStatus;
	/** 明确指定状态区展示模式；未传时按 isActive / configured 回退兼容旧调用。 */
	readonly displayMode?: ImChannelCardDisplayMode;
	readonly onConfigure: () => void;
	/** 仅在该渠道可被切换为活动渠道时传入；活动渠道自身不传。 */
	readonly onActivate?: () => void;
	readonly labels: ImChannelCardViewLabels;
	/** Optional override for status badge (e.g. host-wired i18n). Defaults to ImStatusBadgeView. */
	readonly statusBadge?: ReactNode;
}

/**
 * 渠道卡：整卡是主操作（可激活时切换为活动渠道，否则打开配置），右下角齿轮始终进配置。
 * 多渠道并行时各卡独立展示真实连接状态或待确认/已配置状态，未配置渠道走虚线弱化态。
 */
export function ImChannelCardView({
	name,
	subtitle,
	icon,
	configured,
	isActive,
	effectiveStatus,
	displayMode,
	onConfigure,
	onActivate,
	labels,
	statusBadge,
}: ImChannelCardViewProps): JSX.Element {
	const canActivate = configured && onActivate !== undefined;
	const primaryAction = canActivate ? onActivate : onConfigure;
	const primaryLabel = canActivate ? labels.activateChannelTitle : labels.configureLabel;
	const resolvedDisplayMode: ImChannelCardDisplayMode =
		displayMode ?? (isActive ? "status" : configured ? "configured" : "unconfigured");
	const isErrorCard = resolvedDisplayMode === "status" && effectiveStatus === "error";
	const isHighlightedIcon =
		isActive ||
		(resolvedDisplayMode === "status" &&
			(effectiveStatus === "online" || effectiveStatus === "connecting" || effectiveStatus === "awaiting_bind"));

	return (
		<div
			className={cn(
				"group relative flex flex-col gap-3 rounded-xl border p-3.5 transition-colors duration-200",
				isActive
					? "border-primary/40 bg-primary/10 ring-1 ring-inset ring-primary/30"
					: isErrorCard
						? "border-destructive/40 bg-card/50 hover:border-destructive/60 hover:bg-card/70"
						: configured
							? "border-border/60 bg-card/50 hover:border-primary/40 hover:bg-card/70"
							: "border-dashed border-border/50 bg-card/20 hover:border-primary/40 hover:bg-card/40",
			)}
		>
			{/* 铺满整卡的主操作按钮；卡内其余内容通过 relative 叠在其上。 */}
			<button
				type="button"
				aria-label={`${name} · ${primaryLabel}`}
				title={primaryLabel}
				onClick={primaryAction}
				className="absolute inset-0 rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
			/>

			<div className="pointer-events-none relative flex items-start gap-2.5">
				<ImChannelIconView icon={icon} isActive={isHighlightedIcon} className="h-9 w-9" />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<span className="truncate text-[13px] font-semibold text-foreground">{name}</span>
						{isActive && (
							<span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
								{labels.channelActive}
							</span>
						)}
					</div>
					<div className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground" title={subtitle}>
						{subtitle}
					</div>
				</div>
			</div>

			<div className="relative flex items-center justify-between gap-2">
				<span className="pointer-events-none min-w-0">
					{resolvedDisplayMode === "status" ? (
						(statusBadge ?? <ImStatusBadgeView label={labels.statusLabel} status={effectiveStatus} />)
					) : resolvedDisplayMode === "pending" ? (
						<span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
							<span className="h-1.5 w-1.5 rounded-full bg-current" />
							{labels.channelPending ?? labels.channelConfigured}
						</span>
					) : (
						<span
							className={cn(
								"inline-flex items-center rounded-full px-2 py-0.5 text-[11px]",
								resolvedDisplayMode === "configured"
									? "bg-accent/60 text-muted-foreground"
									: "bg-muted text-muted-foreground/60",
							)}
						>
							{resolvedDisplayMode === "configured" ? labels.channelConfigured : labels.channelNotAssociated}
						</span>
					)}
				</span>
				{canActivate ? (
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={`${name} · ${labels.configureLabel}`}
						title={labels.configureLabel}
						onClick={onConfigure}
					>
						<span className="icon-[solar--settings-linear] h-3 w-3" />
					</Button>
				) : (
					<span
						aria-hidden
						className="pointer-events-none flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors group-hover:text-foreground"
					>
						<span className="icon-[solar--settings-linear] h-3 w-3" />
					</span>
				)}
			</div>
		</div>
	);
}

/** 渠道图标块：品牌资源直接铺满方块，单色图标退回带底色的图标块。 */
export function ImChannelIconView({
	icon,
	isActive,
	className,
}: {
	readonly icon: ImChannelCardIcon;
	readonly isActive: boolean;
	readonly className: string;
}): JSX.Element {
	if (icon.kind === "asset") {
		return (
			<img
				src={icon.url}
				alt=""
				aria-hidden
				className={cn("shrink-0 rounded-lg object-cover", className, !isActive && "opacity-90")}
			/>
		);
	}
	return (
		<span
			className={cn(
				"flex shrink-0 items-center justify-center rounded-lg",
				className,
				isActive ? "bg-primary/15" : "bg-background/60",
			)}
		>
			<span className={cn(icon.className, "h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
		</span>
	);
}
