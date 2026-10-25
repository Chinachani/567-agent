import {
	Button,
	cn,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@vetta-org/ui";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAbilityText } from "../hooks/useAbilityText";
import type { AbilitiesModel, AbilityItem, McpAbility } from "../types";
import { AbilityIcon } from "./AbilityIcon";
import { AbilityStatusBadges } from "./AbilityBadges";
import { AbilityOperationStatus } from "./AbilityOperationStatus";
import { loadAbilityDetailView } from "./detail/loadAbilityDetailView";

function McpMenuItems({ item, model }: { item: McpAbility; model: AbilitiesModel }): JSX.Element {
	const { t } = useTranslation("abilities");
	return (
		<>
			{item.setupRequired && (
				<DropdownMenuItem onSelect={() => model.setup(item)}>
					<span className="icon-[solar--settings-linear] h-3.5 w-3.5" />
					{t("actions.finishSetup")}
				</DropdownMenuItem>
			)}
			{item.usesOAuth && (
				<DropdownMenuItem onSelect={() => (item.authorized ? model.revokeAuthorization(item) : model.setup(item))}>
					<span
						className={cn(
							"h-3.5 w-3.5",
							item.authorized ? "icon-[solar--link-broken-linear]" : "icon-[solar--shield-keyhole-linear]",
						)}
					/>
					{item.authorized ? t("actions.disconnectAccount") : t("actions.connectAccount")}
				</DropdownMenuItem>
			)}
			{item.canConfigure && (
				<DropdownMenuItem onSelect={() => model.configure(item)}>
					<span className="icon-[solar--key-minimalistic-square-linear] h-3.5 w-3.5" />
					{t("actions.configure")}
				</DropdownMenuItem>
			)}
			{item.canEdit && (
				<DropdownMenuItem onSelect={() => model.edit(item)}>
					<span className="icon-[solar--pen-2-linear] h-3.5 w-3.5" />
					{t("actions.edit")}
				</DropdownMenuItem>
			)}
		</>
	);
}

function InstalledMoreMenu({
	item,
	model,
	onOpenDetail,
}: {
	item: AbilityItem;
	model: AbilitiesModel;
	onOpenDetail: () => void;
}): JSX.Element | null {
	const { t } = useTranslation("abilities");

	// 只读能力没有可执行的操作，右侧留空即可，不用「锁」占位。
	if (item.readonly) return null;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label={t("actions.more")}>
					<span className="icon-[solar--menu-dots-bold] h-3.5 w-3.5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem onSelect={onOpenDetail}>
					<span className="icon-[solar--eye-linear] h-3.5 w-3.5" />
					{t("actions.viewDetails")}
				</DropdownMenuItem>
				{item.type === "plugin" && (
					<DropdownMenuItem onSelect={() => model.reloadPlugin(item)}>
						<span className="icon-[solar--restart-linear] h-3.5 w-3.5" />
						{item.pendingVersion
							? t("plugin.reloadVersion", { version: item.pendingVersion })
							: t("actions.reload")}
					</DropdownMenuItem>
				)}
				{item.needsUpdate && (
					<DropdownMenuItem onSelect={() => (item.type === "bundle" ? onOpenDetail() : model.install(item))}>
						<span className="icon-[solar--refresh-linear] h-3.5 w-3.5" />
						{t("actions.update")}
					</DropdownMenuItem>
				)}
				{item.type === "mcp" && <McpMenuItems item={item} model={model} />}
				<DropdownMenuItem onSelect={() => model.toggle(item)}>
					<span
						className={cn(
							"h-3.5 w-3.5",
							item.enabled ? "icon-[solar--pause-circle-linear]" : "icon-[solar--play-circle-linear]",
						)}
					/>
					{item.enabled ? t("actions.disable") : t("actions.enable")}
				</DropdownMenuItem>
				{item.type !== "bundle" && (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem className="text-destructive" onSelect={() => model.uninstall(item)}>
							<span className="icon-[solar--trash-bin-trash-linear] h-3.5 w-3.5" />
							{t("actions.remove")}
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function AbilityCard({
	item,
	model,
	onUnreviewedMcpAdd,
}: {
	item: AbilityItem;
	model: AbilitiesModel;
	onUnreviewedMcpAdd?: (item: McpAbility) => void;
}): JSX.Element {
	const { t } = useTranslation("abilities");
	const navigate = useNavigate();
	const { title, description } = useAbilityText()(item);

	const openDetail = (): void => {
		void navigate({ to: "/abilities", search: { detail: item.id } });
	};

	return (
		<div
			onPointerEnter={() => void loadAbilityDetailView().catch(() => undefined)}
			onPointerDown={() => void loadAbilityDetailView().catch(() => undefined)}
			className={cn(
				"group relative flex h-36 min-w-0 overflow-hidden items-start gap-3 rounded-xl border border-border/70 bg-card/40 p-4 transition-colors duration-200 hover:border-primary/30 hover:bg-accent/30",
				!item.enabled && item.installed && "opacity-75",
			)}
		>
			<button
				type="button"
				disabled={item.busy}
				aria-busy={item.busy}
				aria-label={t("card.openDetails", { name: title })}
				onClick={openDetail}
				className="flex h-full min-w-0 flex-1 cursor-pointer items-start gap-3 text-left outline-none before:absolute before:inset-0 before:rounded-xl focus-visible:before:ring-1 focus-visible:before:ring-inset focus-visible:before:ring-ring disabled:cursor-wait"
			>
				<AbilityIcon icon={item.icon} type={item.type} />
				<span className="min-w-0 flex-1">
					<span className="flex min-w-0 flex-wrap items-center gap-1.5">
						<span className="max-w-full truncate text-[13px] font-semibold text-foreground" title={title}>
							{title}
						</span>
						<AbilityStatusBadges item={item} />
					</span>
					{item.busy ? (
						<span className="mt-0.5 block min-w-0 overflow-hidden text-[11px] leading-relaxed text-muted-foreground">
							<AbilityOperationStatus
								operation={item.operation}
								progress={item.operationProgress}
								className="max-w-full"
							/>
						</span>
					) : (
						<span
							title={description}
							className="mt-1.5 line-clamp-3 break-words text-[12px] leading-relaxed text-muted-foreground"
						>
							{description || t("card.noDescription")}
						</span>
					)}
				</span>
			</button>
			{!item.busy && (
				<div className="relative z-10 shrink-0" onClick={(event) => event.stopPropagation()}>
					{item.installed ? (
						<InstalledMoreMenu item={item} model={model} onOpenDetail={openDetail} />
					) : (
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={t("actions.add")}
							title={t("actions.add")}
							className="rounded-lg border border-transparent bg-transparent text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted hover:text-foreground"
							onClick={() => {
								if (item.type === "bundle") {
									openDetail();
								} else if (item.type === "mcp" && item.reviewStatus === "unreviewed") {
									if (onUnreviewedMcpAdd) onUnreviewedMcpAdd(item);
									else openDetail();
								} else {
									model.install(item);
								}
							}}
						>
							<span className="icon-[solar--add-linear] h-4 w-4" />
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
