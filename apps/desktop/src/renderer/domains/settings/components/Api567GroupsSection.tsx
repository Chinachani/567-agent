import type { ModelsConfigData } from "@preload/api.js";
import { Button } from "@shared/components/ui/button";
import { ProviderIcon } from "@vetta-org/theme-ui/shared";
import { SettingSection } from "@vetta-org/theme-ui/settings";
import {
	Check,
	ChevronDown,
	ChevronUp,
	ExternalLink,
	Key,
	Layers,
	Palette,
	Plus,
	RefreshCw,
	Star,
	Trash2,
	Wallet,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { useApi567 } from "../../api567/hooks/useApi567";

function getProviderIconForGroup(groupName: string): string {
	const lower = groupName.toLowerCase();
	if (lower.includes("claude")) return "claude";
	if (lower.includes("gemini")) return "gemini";
	if (lower.includes("deepseek")) return "deepseek";
	if (lower.includes("grok")) return "grok";
	if (lower.includes("gpt") || lower.includes("chat")) return "openai";
	if (lower.includes("国模") || lower.includes("qwen")) return "qwen";
	return "openai";
}

export function Api567GroupsSection({
	config,
}: {
	config: ModelsConfigData;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const {
		status,
		availableGroups,
		loadAvailableGroups,
		syncGroup,
		removeGroup,
		setActiveGroup,
		setImageGroup,
		setImageModel,
		refreshGroups,
		refreshQuota,
		setModalOpen,
		setTopupModalOpen,
	} = useApi567();

	const [refreshing, setRefreshing] = useState(false);
	const [syncingGroup, setSyncingGroup] = useState<string | null>(null);
	const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

	const handleRefresh = async () => {
		setRefreshing(true);
		try {
			await refreshQuota(true);
			await loadAvailableGroups(true);
			await refreshGroups();
		} finally {
			setRefreshing(false);
		}
	};

	const handleSync = async (groupName: string) => {
		setSyncingGroup(groupName);
		try {
			await syncGroup(groupName);
		} finally {
			setSyncingGroup(null);
		}
	};

	const handleSetActive = async (groupName: string) => {
		setSyncingGroup(groupName);
		try {
			await setActiveGroup(groupName);
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

	// 判定分组是否真正已在本地 models.json 中生效
	const syncedGroupMap = new Map<string, { modelsCount: number; models?: string[]; imageModels?: string[] }>();
	for (const g of status.groups ?? []) {
		syncedGroupMap.set(g.name, {
			modelsCount: g.modelsCount ?? 0,
			models: g.models,
			imageModels: g.imageModels,
		});
	}

	const availableEntries = Object.entries(availableGroups);

	return (
		<>
			<SettingSection
			section={SETTINGS_SECTION["models-preset-providers"]}
			title={
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-2">
						<span className="flex h-5 w-5 items-center justify-center rounded bg-primary text-[10px] font-black text-primary-foreground shadow-sm">
							567
						</span>
						<span className="font-semibold text-[14px]">567 API 分组服务商</span>
					</div>

					<div className="flex items-center gap-2">
						{status.isLoggedIn ? (
							<>
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<span>用户:</span>
									<span className="font-medium text-foreground">{status.username}</span>
									<span>·</span>
									<span>可用额度:</span>
									<span className="font-semibold text-emerald-600 dark:text-emerald-400">
										${status.quotaUsd !== undefined ? status.quotaUsd.toFixed(2) : "0.00"}
									</span>
								</div>
								<Button
									variant="ghost"
									size="sm"
									disabled={refreshing}
									onClick={handleRefresh}
									className="h-7 px-2 text-xs"
									title="刷新余额与状态"
								>
									<RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin text-primary" : ""}`} />
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setTopupModalOpen(true)}
									className="h-7 gap-1.5 px-2.5 text-xs"
								>
									<Wallet className="h-3.5 w-3.5 text-primary" />
									<span>充值额度</span>
								</Button>
							</>
						) : (
							<Button
								size="sm"
								onClick={() => setModalOpen(true)}
								className="h-7 gap-1.5 px-3 text-xs font-medium"
							>
								<Key className="h-3.5 w-3.5" />
								<span>登录 567 API</span>
							</Button>
						)}
					</div>
				</div>
			}
			description="基于 567 API 的模型分组矩阵。选择您想要使用的模型分组，客户端将自动创建或关联专属 API Key 并接入可用模型。"
		>
			{!status.isLoggedIn ? (
				<div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
					<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
						<Layers className="h-6 w-6" />
					</div>
					<div className="max-w-md">
						<h3 className="font-semibold text-foreground text-sm">尚未登录 567 API 账户</h3>
						<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
							登录您的 567 API 账户或绑定系统访问令牌，即可直接在此处选用全网顶尖模型分组（满血 GPT、Claude Max、Gemini 等）。
						</p>
					</div>
					<Button
						onClick={() => setModalOpen(true)}
						size="sm"
						className="mt-1 gap-1.5 px-4 font-semibold"
					>
						<Key className="h-3.5 w-3.5" />
						<span>立即登录 567 API</span>
					</Button>
				</div>
			) : availableEntries.length === 0 ? (
				<div className="p-8 text-center text-muted-foreground text-xs">
					正在拉取模型分组列表，请稍候...
				</div>
			) : (
				<div className="divide-y divide-border">
					{availableEntries.map(([groupName, info]) => {
						const syncedData = syncedGroupMap.get(groupName);
						const isSynced = Boolean(syncedData);
						const isActive = status.activeGroup === groupName;
						const isImageGroup = status.imageGroup === groupName;
						const isBusy = syncingGroup === groupName;
						const isExpanded = expandedGroup === groupName;
						const iconSymbol = getProviderIconForGroup(groupName);

						return (
							<div
								key={groupName}
								className={`flex flex-col p-4 transition-colors ${
									isActive ? "bg-primary/[0.03]" : "hover:bg-muted/20"
								}`}
							>
								<div className="flex items-center justify-between gap-4">
									{/* 左侧：图标与分组信息 */}
									<div className="flex min-w-0 flex-1 items-center gap-3.5">
										<ProviderIcon symbol={iconSymbol} className="h-7 w-7 shrink-0" />
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-medium text-foreground text-sm">{groupName}</span>
												<span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
													{info.ratio}x 倍率
												</span>
												{isActive && (
													<span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
														<Star className="h-3 w-3 fill-current" />
														当前主力
													</span>
												)}
												{isImageGroup && (
													<span className="inline-flex items-center gap-1 rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-bold text-purple-600 dark:text-purple-400">
														<Palette className="h-3 w-3" />
														画图专属
													</span>
												)}
												{isSynced && (
													<span className="text-[11px] text-muted-foreground">
														· 已接入 {syncedData?.modelsCount ?? 0} 个模型
													</span>
												)}
											</div>
											{info.desc && (
												<p className="mt-0.5 truncate text-muted-foreground text-xs" title={info.desc}>
													{info.desc}
												</p>
											)}
										</div>
									</div>

									{/* 右侧：操作区 */}
									<div className="flex shrink-0 items-center gap-2">
										{isSynced ? (
											<>
												{isActive ? (
													<span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-primary text-xs font-medium">
														<Check className="h-3.5 w-3.5" />
														<span>主力生效</span>
													</span>
												) : (
													<Button
														variant="outline"
														size="sm"
														disabled={isBusy}
														onClick={() => void handleSetActive(groupName)}
														className="h-8 gap-1 text-xs"
														title="设为常规对话主力模型分组"
													>
														{isBusy && syncingGroup === groupName ? (
															<span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
														) : (
															<Star className="h-3.5 w-3.5 text-muted-foreground" />
														)}
														<span>设为主力</span>
													</Button>
												)}

												{isImageGroup ? (
													<span className="inline-flex items-center gap-1 rounded-md bg-purple-500/10 px-2.5 py-1 text-purple-600 dark:text-purple-400 text-xs font-medium" title="当前生图调用由此分组承载">
														<Palette className="h-3.5 w-3.5" />
														<span>画图生效</span>
													</span>
												) : (
													<Button
														variant="outline"
														size="sm"
														disabled={isBusy}
														onClick={() => void setImageGroup(groupName)}
														className="h-8 gap-1 text-xs text-muted-foreground hover:text-purple-600 hover:border-purple-300 dark:hover:text-purple-400"
														title="将此分组设为专属画图通道"
													>
														<Palette className="h-3.5 w-3.5" />
														<span>设为画图</span>
													</Button>
												)}

												<Button
													variant="ghost"
													size="sm"
													disabled={isBusy}
													onClick={() => void handleSync(groupName)}
													className="h-8 w-8 p-0 text-muted-foreground hover:bg-primary/10 hover:text-primary"
													title="重新拉取并更新此分组模型"
												>
													<RefreshCw className={`h-3.5 w-3.5 ${isBusy && syncingGroup === groupName ? "animate-spin text-primary" : ""}`} />
												</Button>

												{((syncedData?.models && syncedData.models.length > 0) || (syncedData?.imageModels && syncedData.imageModels.length > 0)) && (
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setExpandedGroup(isExpanded ? null : groupName)}
														className="h-8 px-2 text-xs text-muted-foreground"
														title="查看模型"
													>
														{isExpanded ? (
															<ChevronUp className="h-4 w-4" />
														) : (
															<ChevronDown className="h-4 w-4" />
														)}
													</Button>
												)}

												<Button
													variant="ghost"
													size="sm"
													disabled={isBusy}
													onClick={() => void removeGroup(groupName)}
													className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
													title="移除该分组"
												>
													<Trash2 className="h-3.5 w-3.5" />
												</Button>
											</>
										) : (
											<Button
												size="sm"
												disabled={isBusy}
												onClick={() => void handleSync(groupName)}
												className="h-8 gap-1 px-3 text-xs font-semibold"
											>
												{isBusy ? (
													<>
														<span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
														<span>接入中...</span>
													</>
												) : (
													<>
														<Plus className="h-3.5 w-3.5" />
														<span>一键接入</span>
													</>
												)}
											</Button>
										)}
									</div>
								</div>

								{/* 展开展示该分组下的模型列表 */}
								{isExpanded && syncedData && (
									<div className="mt-3 space-y-3 rounded-lg border border-border/70 bg-muted/30 p-3">
										{syncedData.models && syncedData.models.length > 0 && (
											<div>
												<div className="mb-1.5 font-medium text-[11px] text-muted-foreground">
													语言与对话模型 ({syncedData.models.length}):
												</div>
												<div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
													{syncedData.models.map((mId) => (
														<span
															key={mId}
															className="inline-block rounded border border-border/60 bg-background px-2 py-0.5 font-mono text-[11px] text-foreground"
														>
															{mId}
														</span>
													))}
												</div>
											</div>
										)}

										{syncedData.imageModels && syncedData.imageModels.length > 0 && (
											<div>
												<div className="mb-1.5 flex items-center justify-between font-medium text-[11px] text-purple-600 dark:text-purple-400">
													<span>画图 / 生图模型 ({syncedData.imageModels.length}):</span>
													{isImageGroup && (
														<span className="text-[10px] text-muted-foreground font-normal">
															当前默认: <strong className="text-purple-600 dark:text-purple-300">{status.imageModel || "dall-e-3"}</strong>
														</span>
													)}
												</div>
												<div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto pr-1">
													{syncedData.imageModels.map((mId) => {
														const isCurImageModel = status.imageModel === mId;
														return (
															<button
																key={mId}
																type="button"
																onClick={() => void setImageModel(mId)}
																className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] transition-colors cursor-pointer ${
																	isCurImageModel
																		? "border-purple-500 bg-purple-500/10 font-bold text-purple-600 dark:text-purple-300"
																		: "border-border/60 bg-background text-foreground hover:border-purple-400 hover:text-purple-500"
																}`}
																title="点击将此模型设为默认生图模型"
															>
																<Palette className="h-3 w-3" />
																<span>{mId}</span>
																{isCurImageModel && <Check className="h-3 w-3" />}
															</button>
														);
													})}
												</div>
											</div>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</SettingSection>
		</>
	);
}
