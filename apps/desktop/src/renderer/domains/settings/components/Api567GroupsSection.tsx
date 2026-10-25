import { Api567GroupModels } from "./Api567GroupModels";
import { SettingsListSearch, matchesSettingsSearch } from "./SettingsListSearch";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import type { ModelsConfigData } from "@preload/api.js";
import { Button } from "@shared/components/ui/button";
import { BrandIcon } from "@shared/components/BrandIcon";
import { ProviderIcon } from "@vetta-org/theme-ui/shared";
import { SettingSection } from "@vetta-org/theme-ui/settings";
import { ChevronDown, ChevronUp, Key, Layers, Palette, Plus, RefreshCw, Star, Wallet } from "lucide-react";
import { confirmDialogAtom } from "@shared/store/atoms";
import { useSetAtom } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { useApi567 } from "../../api567/hooks/useApi567";
import { ServiceRouteSettings } from "../../api567";

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

export function Api567GroupsSection({ config }: { config: ModelsConfigData }): JSX.Element {
	const { t } = useTranslation("settings");
	const setConfirm = useSetAtom(confirmDialogAtom);
	const {
		status,
		availableGroups,
		groupsLoadState,
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
	const [pendingGroupAction, setPendingGroupAction] = useState<{
		groupName: string;
		kind: "sync" | "active" | "image";
	} | null>(null);
	const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const actionsDisabled = pendingGroupAction !== null || refreshing;

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
		setPendingGroupAction({ groupName, kind: "sync" });
		try {
			await syncGroup(groupName);
		} finally {
			setPendingGroupAction(null);
		}
	};

	const handleSetActive = async (groupName: string, modelName?: string) => {
		setPendingGroupAction({ groupName, kind: "active" });
		try {
			await setActiveGroup(groupName, modelName);
		} finally {
			setPendingGroupAction(null);
		}
	};

	const handleImageGroup = async (groupName: string) => {
		setPendingGroupAction({ groupName, kind: "image" });
		try {
			await setImageGroup(groupName);
		} finally {
			setPendingGroupAction(null);
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
	const visibleEntries = availableEntries.filter(([name, info]) =>
		matchesSettingsSearch(query, [name, info.desc ?? "", ...(syncedGroupMap.get(name)?.models ?? [])]),
	);

	return (
		<>
			<SettingSection
				section={SETTINGS_SECTION["models-preset-providers"]}
				title={
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<BrandIcon className="h-5 w-5" />
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
										<span className="font-semibold text-foreground">
											${status.quotaUsd !== undefined ? status.quotaUsd.toFixed(2) : "0.00"}
										</span>
									</div>
									<Button
										variant="ghost"
										size="sm"
										disabled={actionsDisabled}
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
				<div className="border-b border-border px-4 py-2">
					<ServiceRouteSettings />
				</div>
				{status.isLoggedIn && availableEntries.length > 0 && (
					<SettingsListSearch
						value={query}
						onChange={setQuery}
						label={t("listSearch.groups")}
						count={visibleEntries.length}
						total={availableEntries.length}
					/>
				)}
				{!status.isLoggedIn ? (
					<div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
						<div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
							<Layers className="h-6 w-6" />
						</div>
						<div className="max-w-md">
							<h3 className="font-semibold text-foreground text-sm">尚未登录 567 API 账户</h3>
							<p className="mt-1 text-muted-foreground text-xs leading-relaxed">
								登录您的 567 API 账户或绑定系统访问令牌，即可直接在此处选用全网顶尖模型分组（满血 GPT、Claude
								Max、Gemini 等）。
							</p>
						</div>
						<Button onClick={() => setModalOpen(true)} size="sm" className="mt-1 gap-1.5 px-4 font-semibold">
							<Key className="h-3.5 w-3.5" />
							<span>立即登录 567 API</span>
						</Button>
					</div>
				) : availableEntries.length === 0 ? (
					<div className="space-y-2 p-8 text-center text-muted-foreground text-xs" role="status">
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
					<div className="divide-y divide-border">
						{visibleEntries.length === 0 && (
							<p role="status" className="px-4 py-6 text-center text-[12px] text-muted-foreground">
								{t("listSearch.noGroups")}
							</p>
						)}
						{visibleEntries.map(([groupName, info]) => {
							const syncedData = syncedGroupMap.get(groupName);
							const isSynced = Boolean(syncedData);
							const isActive = status.activeGroup === groupName;
							const isImageGroup = status.imageGroup === groupName;
							const isCurrentGroup = pendingGroupAction?.groupName === groupName;
							const isSyncing = isCurrentGroup && pendingGroupAction?.kind === "sync";
							const isExpanded = expandedGroup === groupName;
							const iconSymbol = getProviderIconForGroup(groupName);

							return (
								<div
									key={groupName}
									className={`flex flex-col p-4 transition-colors ${
										isActive ? "bg-accent/20" : "hover:bg-muted/20"
									}`}
								>
									<div className="flex flex-wrap items-center justify-between gap-3">
										{/* 左侧：图标与分组信息 */}
										<div className="flex min-w-0 flex-1 basis-64 items-center gap-3">
											<ProviderIcon symbol={iconSymbol} className="h-6 w-6 shrink-0" />
											<div className="min-w-0 flex-1">
												<div className="flex flex-wrap items-center gap-2">
													<span className="font-medium text-foreground text-sm">{groupName}</span>
													<span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
														{info.ratio}x 倍率
													</span>
													{isActive && (
														<span className="inline-flex items-center gap-1 rounded bg-chat-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-chat-accent">
															<Star className="h-3 w-3 fill-current" />
															当前主力
														</span>
													)}
													{isImageGroup && (
														<span className="inline-flex items-center gap-1 rounded bg-image-accent/15 px-1.5 py-0.5 text-[10px] font-bold text-image-accent ring-1 ring-inset ring-image-accent/30">
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
											{isSynced && isSyncing && (
												<span role="status" className="text-xs text-muted-foreground">
													{t("api567Models.refreshing")}
												</span>
											)}
											{isSynced ? (
												<>
													{!isActive && (
														<Button
															variant="outline"
															size="sm"
															disabled={actionsDisabled}
															onClick={() => void handleSetActive(groupName)}
															className="h-8 gap-1 text-xs"
															title="设为常规对话主力模型分组"
														>
															{isCurrentGroup && pendingGroupAction?.kind === "active" ? (
																<span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
															) : (
																<Star className="h-3.5 w-3.5 text-muted-foreground" />
															)}
															<span>设为主力</span>
														</Button>
													)}

													{!isImageGroup && (
														<Button
															variant="outline"
															size="sm"
															disabled={actionsDisabled}
															onClick={() => void handleImageGroup(groupName)}
															className="h-8 gap-1 text-xs text-muted-foreground hover:text-primary hover:border-primary/40"
															title="将此分组设为专属画图通道"
														>
															<Palette className="h-3.5 w-3.5" />
															<span>设为画图</span>
														</Button>
													)}

													{((syncedData?.models && syncedData.models.length > 0) ||
														(syncedData?.imageModels && syncedData.imageModels.length > 0)) && (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => setExpandedGroup(isExpanded ? null : groupName)}
															className="h-8 px-2 text-xs text-muted-foreground"
															title={t("api567Models.expand")}
															aria-label={t("api567Models.expandGroup", { group: groupName })}
															aria-expanded={isExpanded}
														>
															{isExpanded ? (
																<ChevronUp className="h-4 w-4" />
															) : (
																<ChevronDown className="h-4 w-4" />
															)}
														</Button>
													)}

													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																disabled={actionsDisabled}
																aria-label={t("api567Models.more", { group: groupName })}
															>
																<span
																	className={
																		isSyncing
																			? "icon-[solar--refresh-linear] h-4 w-4 animate-spin"
																			: "icon-[solar--menu-dots-linear] h-4 w-4"
																	}
																/>
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onSelect={() => void handleSync(groupName)}>
																{t("api567Models.refresh")}
															</DropdownMenuItem>
															<DropdownMenuItem
																onSelect={() =>
																	setConfirm({
																		title: t("api567Account.removeTitle"),
																		message: t("api567Account.removeMessage", { name: groupName }),
																		variant: "danger",
																		onConfirm: () => {
																			void removeGroup(groupName);
																		},
																	})
																}
															>
																{t("api567Models.remove")}
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</>
											) : (
												<Button
													size="sm"
													disabled={actionsDisabled}
													onClick={() => void handleSync(groupName)}
													className="h-8 gap-1 px-3 text-xs font-semibold"
												>
													{isSyncing ? (
														<>
															<span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
															<span role="status">{t("api567Models.connecting")}</span>
														</>
													) : (
														<>
															<Plus className="h-3.5 w-3.5" />
															<span>{t("api567Models.connect")}</span>
														</>
													)}
												</Button>
											)}
										</div>
									</div>

									{isExpanded && syncedData && (
										<Api567GroupModels
											models={syncedData.models ?? []}
											selectedChatModel={isActive ? status.activeModel : undefined}
											onSelectChat={(model) => {
												if (isActive && status.activeModel === model) return;
												void handleSetActive(groupName, model);
											}}
											imageModels={syncedData.imageModels ?? []}
											selectedImageModel={isImageGroup ? status.imageModel : undefined}
											busy={actionsDisabled}
											onSelectImage={(model) =>
												void (async () => {
													if (isImageGroup && status.imageModel === model) return;
													setPendingGroupAction({ groupName, kind: "image" });
													try {
														if (!isImageGroup && !(await setImageGroup(groupName)).success) return;
														await setImageModel(model);
													} finally {
														setPendingGroupAction(null);
													}
												})()
											}
										/>
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
