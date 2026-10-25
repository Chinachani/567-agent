import { Button } from "@shared/components/ui/button";
import { UserAvatar } from "@shared/components/UserAvatar";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Check, ChevronRight, Layers, Plus, RefreshCw, Star, Wallet } from "lucide-react";
import { useRef, useState } from "react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import type { useApi567 } from "../hooks/useApi567";
import { ServiceRouteSettings } from "./ServiceRouteSettings";

interface Api567AccountDialogProps {
	api: Pick<
		ReturnType<typeof useApi567>,
		| "status"
		| "availableGroups"
		| "groupsLoadState"
		| "loadAvailableGroups"
		| "syncGroup"
		| "setActiveGroup"
		| "refreshQuota"
	>;
	open: boolean;
	onOpenChange(open: boolean): void;
	onTopup(): void;
	onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
}

export function Api567AccountDialog({
	api,
	open,
	onOpenChange,
	onTopup,
	onCloseAutoFocus,
}: Api567AccountDialogProps): JSX.Element | null {
	const { t } = useTranslation("settings");
	const { t: common } = useTranslation("common");
	const { status, availableGroups, groupsLoadState, loadAvailableGroups, syncGroup, setActiveGroup, refreshQuota } =
		api;
	const actionRef = useRef(false);
	const content = useRef<HTMLDivElement>(null);
	const [refreshing, setRefreshing] = useState(false);
	const [syncingGroup, setSyncingGroup] = useState<string | null>(null);

	const handleRefresh = async () => {
		setRefreshing(true);
		try {
			await refreshQuota(true);
		} finally {
			setRefreshing(false);
		}
	};

	const handleGroup = async (groupName: string, active: boolean) => {
		if (actionRef.current) return;
		actionRef.current = true;
		setSyncingGroup(groupName);
		try {
			if (active) await setActiveGroup(groupName);
			else await syncGroup(groupName);
		} finally {
			actionRef.current = false;
			setSyncingGroup(null);
		}
	};
	if (!status.isLoggedIn) {
		return null;
	}

	const syncedGroupNames = new Set((status.groups ?? []).map((g) => g.name));
	const availableEntries = Object.entries(availableGroups);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				onCloseAutoFocus={onCloseAutoFocus}
				ref={content}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					content.current?.querySelector<HTMLButtonElement>("button")?.focus();
				}}
				className="max-h-[85dvh] max-w-[min(28rem,calc(100%-2rem))] overflow-y-auto text-[12px]"
			>
				<DialogHeader className="pr-8">
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-1.5">
							<span aria-hidden="true">
								<UserAvatar
									username={status.loginUsername || status.username}
									className="h-5 w-5 shrink-0"
									textClassName="text-[11px]"
								/>
							</span>
							<DialogTitle>{t("api567Account.title")}</DialogTitle>
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={handleRefresh}
							disabled={refreshing}
							className="text-muted-foreground hover:text-foreground transition-colors p-1"
							title={t("api567Account.refresh")}
						>
							<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-primary" : ""}`} />
						</Button>
					</div>
					<DialogDescription>{t("api567Account.detailsHint")}</DialogDescription>
				</DialogHeader>

				{/* 账户摘要卡片 */}
				<div className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground">{t("api567Account.username")}</span>
						<span className="font-medium text-foreground">{status.username || t("api567Account.unknown")}</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground flex items-center gap-1">
							<Wallet className="h-3 w-3" />
							{t("api567Account.quota")}
						</span>
						<span className="font-bold text-sm text-foreground">
							${status.quotaUsd !== undefined ? status.quotaUsd.toFixed(2) : "0.00"}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground">{t("api567Account.active")}</span>
						<span className="font-semibold text-primary">
							{status.activeGroup || t("api567Account.defaultGroup")}
						</span>
					</div>
					<div className="border-t border-border/50 pt-1">
						<ServiceRouteSettings />
					</div>
				</div>
				{/* 分组管理与自动接入区 */}
				<div className="mt-3.5">
					<div className="mb-2 flex items-center justify-between font-semibold text-xs text-foreground">
						<div className="flex items-center gap-1">
							<Layers className="h-3.5 w-3.5 text-primary" />
							<span>{t("api567Account.groups")}</span>
						</div>
						<span className="text-[10px] text-muted-foreground font-normal">
							{t("api567Account.connected", { count: syncedGroupNames.size })}
						</span>
					</div>

					{availableEntries.length > 0 && groupsLoadState.error && (
						<div role="alert" className="mb-2 text-destructive">
							<p>{t("api567Feedback.groupsFailed")}</p>
							<Button variant="outline" size="sm" onClick={() => void loadAvailableGroups(true)}>
								{t("api567Feedback.retry")}
							</Button>
						</div>
					)}
					<div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-0.5">
						{availableEntries.length === 0 ? (
							<div
								className="min-h-32 space-y-2 py-3 text-center text-muted-foreground text-[11px]"
								role="status"
							>
								<p>
									{t(
										groupsLoadState.loading
											? "api567Feedback.groupsLoading"
											: groupsLoadState.error
												? "api567Feedback.groupsFailed"
												: "api567Feedback.groupsEmpty",
									)}
								</p>
								{!groupsLoadState.loading && (
									<Button variant="outline" size="sm" onClick={() => void loadAvailableGroups(true)}>
										{t("api567Feedback.retry")}
									</Button>
								)}
							</div>
						) : (
							availableEntries.map(([groupName, info]) => {
								const isSynced = syncedGroupNames.has(groupName);
								const isActive = status.activeGroup === groupName;
								const isBusy = syncingGroup === groupName;

								return (
									<div
										key={groupName}
										className={`flex items-center justify-between rounded-lg border p-2 text-xs transition-colors ${
											isActive
												? "border-primary/50 bg-primary/5"
												: isSynced
													? "border-border/80 bg-background hover:bg-muted/30"
													: "border-dashed border-border/60 bg-muted/20 opacity-80 hover:opacity-100"
										}`}
									>
										<div className="min-w-0 flex-1 pr-2">
											<div className="flex items-center gap-1.5">
												<span className="truncate font-medium text-foreground">{groupName}</span>
												<span className="shrink-0 rounded bg-primary/10 px-1 py-0.2 text-[10px] font-semibold text-primary">
													{info.ratio}x
												</span>
												{isActive && (
													<span className="flex items-center gap-0.5 rounded bg-chat-accent/15 px-1 text-[9px] font-bold text-chat-accent">
														<Star className="h-2.5 w-2.5 fill-current" />
														{t("api567Account.main")}
													</span>
												)}
											</div>
											{info.desc && (
												<p className="mt-0.5 truncate text-[10px] text-muted-foreground">{info.desc}</p>
											)}
										</div>

										<div className="shrink-0">
											{isSynced ? (
												isActive ? (
													<span className="flex h-6 items-center px-1.5 text-[11px] font-medium text-primary">
														<Check className="h-3.5 w-3.5" />
													</span>
												) : (
													<Button
														variant="outline"
														size="sm"
														className="h-6 px-2 text-[10px]"
														disabled={syncingGroup !== null}
														onClick={() => void handleGroup(groupName, true)}
													>
														{t(isBusy ? "api567Account.settingMain" : "api567Account.setMain")}
													</Button>
												)
											) : (
												<Button
													variant="secondary"
													size="sm"
													disabled={syncingGroup !== null}
													className="h-6 gap-1 px-2 text-[10px]"
													onClick={() => handleGroup(groupName, false)}
												>
													{isBusy ? (
														<span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
													) : (
														<Plus className="h-3 w-3" />
													)}
													<span>{t(isBusy ? "api567Account.connecting" : "api567Account.connect")}</span>
												</Button>
											)}
										</div>
									</div>
								);
							})
						)}
					</div>
				</div>

				{/* 底部功能快捷操作 */}
				<div className="mt-4 flex flex-col gap-1.5 border-border/50 border-t pt-3">
					<Button variant="outline" size="sm" className="h-7 w-full justify-between text-xs" onClick={onTopup}>
						<span className="flex items-center gap-1.5 font-medium text-foreground">
							<Wallet className="h-3.5 w-3.5 text-primary" />
							<span>{t("api567Account.topup")}</span>
						</span>
						<ChevronRight className="h-3 w-3 text-muted-foreground" />
					</Button>
				</div>
				<DialogClose asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						className="absolute right-2 top-2"
						aria-label={common("actions.close")}
					>
						<span aria-hidden="true" className="icon-[solar--close-circle-linear] h-4 w-4" />
					</Button>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
}
