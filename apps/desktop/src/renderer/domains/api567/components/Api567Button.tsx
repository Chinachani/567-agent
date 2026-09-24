import { Button } from "@shared/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { Check, ChevronRight, ExternalLink, Layers, LogOut, Plus, RefreshCw, Star, Wallet } from "lucide-react";
import { useState } from "react";
import { useApi567 } from "../hooks/useApi567";

export function Api567Button(): JSX.Element | null {
	const {
		status,
		availableGroups,
		syncGroup,
		setActiveGroup,
		refreshQuota,
		logout,
		setTopupModalOpen,
	} = useApi567();
	const [popoverOpen, setPopoverOpen] = useState(false);
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

	const handleSyncGroup = async (groupName: string) => {
		setSyncingGroup(groupName);
		try {
			await syncGroup(groupName);
		} finally {
			setSyncingGroup(null);
		}
	};

	const openExternal = (url: string) => {
		if (window.vetta?.shell?.openExternal) {
			void window.vetta.shell.openExternal(url);
		} else {
			window.open(url, "_blank");
		}
	};

	if (!status.isLoggedIn) {
		return null;
	}

	const syncedGroupNames = new Set((status.groups ?? []).map((g) => g.name));
	const availableEntries = Object.entries(availableGroups);

	return (
		<Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-background/50 px-2.5 py-1 text-xs font-medium shadow-none hover:bg-muted/80"
				>
					<span className="flex h-4 w-4 items-center justify-center rounded bg-primary text-[10px] font-black text-primary-foreground">
						5
					</span>
					<span className="max-w-[90px] truncate">{status.username || "567 用户"}</span>
					{status.activeGroup && (
						<span className="max-w-[80px] truncate rounded bg-muted/80 px-1 py-0.5 text-[10px] text-muted-foreground font-normal">
							{status.activeGroup}
						</span>
					)}
					<span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
						${status.quotaUsd !== undefined ? status.quotaUsd.toFixed(2) : "0.00"}
					</span>
				</Button>
			</PopoverTrigger>

			<PopoverContent align="end" className="w-80 max-h-[85vh] overflow-y-auto p-4 text-xs">
				<PopoverHeader className="mb-2.5">
					<PopoverTitle className="flex items-center justify-between text-xs font-bold text-foreground">
						<div className="flex items-center gap-1.5">
							<span className="flex h-5 w-5 items-center justify-center rounded bg-primary text-xs font-black text-primary-foreground">
								567
							</span>
							<span>567 API 账户</span>
						</div>
						<button
							type="button"
							onClick={handleRefresh}
							disabled={refreshing}
							className="text-muted-foreground hover:text-foreground transition-colors p-1"
							title="刷新余额"
						>
							<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-primary" : ""}`} />
						</button>
					</PopoverTitle>
				</PopoverHeader>

				{/* 账户摘要卡片 */}
				<div className="flex flex-col gap-2 rounded-xl bg-muted/40 p-3">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground">用户名称</span>
						<span className="font-medium text-foreground">{status.username || "未知"}</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground flex items-center gap-1">
							<Wallet className="h-3 w-3" />
							当前可用额度
						</span>
						<span className="font-bold text-sm text-emerald-600 dark:text-emerald-400">
							${status.quotaUsd !== undefined ? status.quotaUsd.toFixed(2) : "0.00"}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground">当前主力分组</span>
						<span className="font-semibold text-primary">{status.activeGroup || "默认分组"}</span>
					</div>
				</div>

				{/* 分组管理与自动接入区 */}
				<div className="mt-3.5">
					<div className="mb-2 flex items-center justify-between font-semibold text-xs text-foreground">
						<div className="flex items-center gap-1">
							<Layers className="h-3.5 w-3.5 text-primary" />
							<span>API 分组与模型接入</span>
						</div>
						<span className="text-[10px] text-muted-foreground font-normal">
							已接入 {syncedGroupNames.size} 个
						</span>
					</div>

					<div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto pr-0.5">
						{availableEntries.length === 0 ? (
							<div className="py-3 text-center text-muted-foreground text-[11px]">
								暂无可用分组或正在加载...
							</div>
						) : (
							availableEntries.map(([groupName, info]) => {
								const isSynced = syncedGroupNames.has(groupName);
								const isActive = status.activeGroup === groupName;
								const isBusy = syncingGroup === groupName;

								return (
									<div
										key={groupName}
										className={`flex items-center justify-between rounded-lg border p-2 text-xs transition-all ${
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
													<span className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1 text-[9px] font-bold text-amber-600 dark:text-amber-400">
														<Star className="h-2.5 w-2.5 fill-current" />
														主力
													</span>
												)}
											</div>
											{info.desc && (
												<p className="mt-0.5 truncate text-[10px] text-muted-foreground">
													{info.desc}
												</p>
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
														onClick={() => setActiveGroup(groupName)}
													>
														设为主力
													</Button>
												)
											) : (
												<Button
													variant="secondary"
													size="sm"
													disabled={isBusy}
													className="h-6 gap-1 px-2 text-[10px]"
													onClick={() => handleSyncGroup(groupName)}
												>
													{isBusy ? (
														<span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
													) : (
														<Plus className="h-3 w-3" />
													)}
													<span>接入</span>
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
					<Button
						variant="outline"
						size="sm"
						className="h-7 w-full justify-between text-xs"
						onClick={() => {
							setPopoverOpen(false);
							setTopupModalOpen(true);
						}}
					>
						<span className="flex items-center gap-1.5 font-medium text-foreground">
							<Wallet className="h-3.5 w-3.5 text-primary" />
							<span>账户额度充值</span>
						</span>
						<ChevronRight className="h-3 w-3 text-muted-foreground" />
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="h-7 w-full justify-between text-xs"
						onClick={() => openExternal("https://api.567.wiki/console/personal")}
					>
						<span>567 控制台</span>
						<ExternalLink className="h-3 w-3 text-muted-foreground" />
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 w-full justify-between text-destructive text-xs hover:bg-destructive/10 hover:text-destructive"
						onClick={logout}
					>
						<span>退出 567 登录</span>
						<LogOut className="h-3 w-3" />
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
