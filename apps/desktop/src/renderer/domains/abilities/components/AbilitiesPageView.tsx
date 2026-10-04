import { SegmentedControl } from "@vetta-org/theme-ui/shared";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@vetta-org/ui";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CapabilitiesTour } from "@shared/tour";
import { showToast } from "@shared/store/toast-atoms";
import { SettingsAiAssist } from "../../settings/ai-assist";
import { resolveCategoryLabel } from "../lib/ability-presentation";
import {
	ABILITY_CATEGORY_CONNECTORS,
	ABILITY_CATEGORY_UNCATEGORIZED,
	ABILITY_CATEGORY_VETTA_BUILTIN,
	ENABLE_ABILITY_CATEGORIES,
	type AbilitiesModel,
	type AbilityScope,
	type McpAbility,
} from "../types";
import { AbilitiesBanner } from "./AbilitiesBanner";
import { AbilityCard } from "./AbilityCard";
import { AbilityMcpDialogs } from "./AbilityMcpDialogs";
import { AddAbilityMenu } from "./AddAbilityMenu";
import { MarketplaceSourcesDialog } from "./MarketplaceSourcesDialog";
import { UnreviewedMcpPromptDialog } from "./UnreviewedMcpPromptDialog";

const easeOut = [0.22, 1, 0.36, 1] as const;

export interface AbilitiesPageViewProps {
	model: AbilitiesModel;
	/** 是否按分类展示；缺省由代码级常量 ENABLE_ABILITY_CATEGORIES 控制。 */
	categorized?: boolean;
}

export function AbilitiesPageView({
	model,
	categorized = ENABLE_ABILITY_CATEGORIES,
}: AbilitiesPageViewProps): JSX.Element {
	const { t, i18n } = useTranslation("abilities");
	const skillFileInputRef = useRef<HTMLInputElement>(null);
	const pluginFileInputRef = useRef<HTMLInputElement>(null);
	const [sourcesDialogOpen, setSourcesDialogOpen] = useState(false);
	const [filtersOpen, setFiltersOpen] = useState(false);
	const [unreviewedMcp, setUnreviewedMcp] = useState<McpAbility | null>(null);
	const wasRefreshing = useRef(model.refreshing);
	const hasActiveFilter = Boolean(
		model.searchQuery || model.typeFilter || model.category || model.reviewFilter !== "all" || model.tagFilter,
	);
	const activeFilterCount = [model.typeFilter, model.category, model.reviewFilter !== "all", model.tagFilter].filter(Boolean).length;

	useEffect(() => {
		if (wasRefreshing.current && !model.refreshing) {
			const statuses = model.marketplaceCatalog.snapshots
				.map((snapshot) => snapshot.discovery)
				.filter((status): status is NonNullable<typeof status> => Boolean(status));
			if (statuses.length > 0) {
				const loaded = statuses.reduce((sum, status) => sum + status.loaded, 0);
				const total = statuses.reduce((sum, status) => sum + status.total, 0);
				const incomplete = statuses.some((status) => status.failedShards > 0 || status.error);
				showToast({
					variant: incomplete ? "warning" : "success",
					title: t("discovery.toastTitle"),
					message: t(incomplete ? "discovery.toastIncomplete" : "discovery.toastLoaded", { loaded, total }),
					durationMs: incomplete ? 0 : 4500,
					...(incomplete ? { action: { label: t("actions.refresh"), onClick: model.refresh } } : {}),
				});
			}
		}
		wasRefreshing.current = model.refreshing;
	}, [model.marketplaceCatalog.snapshots, model.refresh, model.refreshing, t]);

	return (
		<div className="relative flex h-full w-full flex-1 flex-col overflow-hidden">
			<input
				ref={skillFileInputRef}
				type="file"
				accept=".zip,.tar.gz,.tgz,application/zip,application/gzip,application/x-gzip"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) model.importSkillArchive(file);
				}}
			/>
			<input
				ref={pluginFileInputRef}
				type="file"
				accept=".567plugin,.vettapkg,application/vnd.vetta.plugin+zip,.zip,application/zip"
				className="hidden"
				onChange={(event) => {
					const file = event.target.files?.[0];
					event.target.value = "";
					if (file) model.importPluginArchive(file);
				}}
			/>

			<div className="flex-1 overflow-y-auto px-8 pb-8 [scrollbar-gutter:stable]">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
					<div className="relative shrink-0 pt-5 pb-4">
						<motion.div
							className="flex items-end justify-between gap-4"
							initial={{ opacity: 0, y: -8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ duration: 0.5, ease: easeOut }}
						>
							<div className="min-w-0">
								<h1 className="bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-[26px] font-bold leading-tight tracking-tight text-transparent">
									{t("page.title")}
								</h1>
								<p className="mt-1 text-[12px] text-muted-foreground/60">{t("page.subtitle")}</p>
							</div>
							<div className="flex min-h-8 shrink-0 items-center gap-2">
								<SettingsAiAssist tabId="mcp" />
							</div>
						</motion.div>
					</div>

					<AbilitiesBanner />

					<div className="sticky top-0 z-30 -mx-8 flex flex-col gap-2 border-b border-border/70 bg-background/95 px-8 py-3 shadow-sm backdrop-blur-md">
						<div data-tour="capabilities-search-add" className="flex min-w-0 items-center gap-2">
							<div className="relative min-w-0 flex-1">
								<span className="icon-[solar--magnifer-linear] absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
								<input
									type="text"
									aria-label={t("search.placeholder")}
									placeholder={t("search.placeholder")}
									value={model.searchQuery}
									onChange={(event) => model.setSearchQuery(event.target.value)}
									className="h-8 w-full rounded-lg bg-secondary pl-8 pr-3 text-[12px] text-foreground placeholder:text-muted-foreground/40 transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
								/>
							</div>
							<Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
								<PopoverTrigger asChild>
									<Button variant={activeFilterCount > 0 ? "secondary" : "outline"} size="sm" className="h-8 shrink-0">
										<span className="icon-[solar--filter-linear] h-3.5 w-3.5" />
										{t("filter.trigger")}
										{activeFilterCount > 0 && <span className="ml-0.5 tabular-nums">{activeFilterCount}</span>}
									</Button>
								</PopoverTrigger>
								<PopoverContent align="start" className="w-72">
									<p className="px-1 text-[12px] font-semibold">{t("filter.title")}</p>
									<label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
										{t("filter.type")}
										<select aria-label={t("filter.type")} value={model.typeFilter} onChange={(event) => model.setTypeFilter(event.target.value as typeof model.typeFilter)} className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground">
											<option value="">{t("filter.allTypes")}</option>
											{(model.availableTypes ?? Array.from(new Set(model.allItems.map((item) => item.type))).filter(Boolean)).map((type) => <option key={type} value={type}>{t(`type.${type}`)}</option>)}
										</select>
									</label>
									<label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
										{t("filter.category")}
										<select aria-label={t("filter.category")} value={model.category} onChange={(event) => model.setCategory(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground">
											<option value="">{t("filter.allCategories")}</option>
											{model.categories.map((group) => <option key={group.category} value={group.category}>{group.category === ABILITY_CATEGORY_UNCATEGORIZED ? t("group.uncategorized") : group.category === ABILITY_CATEGORY_CONNECTORS ? t("group.connectors") : group.category === ABILITY_CATEGORY_VETTA_BUILTIN ? t("group.vettaBuiltin") : resolveCategoryLabel(group.category, group.categoryI18n, i18n.language)}</option>)}
										</select>
									</label>
									<label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
										{t("filter.review")}
										<select aria-label={t("filter.review")} value={model.reviewFilter} onChange={(event) => model.setReviewFilter(event.target.value as typeof model.reviewFilter)} className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground">
											<option value="all">{t("filter.allReviewStatuses")}</option><option value="unreviewed">{t("filter.unreviewed")}</option>
										</select>
									</label>
									<label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
										{t("filter.tag")}
										<select aria-label={t("filter.tag")} value={model.tagFilter} onChange={(event) => model.setTagFilter(event.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground">
											<option value="">{t("filter.allTags")}</option>
											{model.availableTags.map((tag) => <option key={tag.toLocaleLowerCase()} value={tag}>{tag}</option>)}
										</select>
									</label>
									<div className="flex justify-end pt-1">
										<Button type="button" variant="ghost" size="sm" disabled={activeFilterCount === 0} onClick={() => { model.setTypeFilter(""); model.setCategory(""); model.setReviewFilter("all"); model.setTagFilter(""); }}>{t("filter.clear")}</Button>
									</div>
								</PopoverContent>
							</Popover>
							<AddAbilityMenu
								importing={model.importing}
								onImportSkill={() => {
									model.setScope("mine");
									skillFileInputRef.current?.click();
								}}
								onImportPlugin={() => {
									model.setScope("mine");
									pluginFileInputRef.current?.click();
								}}
								onAddMcp={() => {
									model.setScope("mine");
									model.startAddManualMcp();
								}}
							/>
						</div>
						<div className="flex items-center justify-end gap-2">
							<Button variant="ghost" size="sm" onClick={() => setSourcesDialogOpen(true)}>
								<span className="icon-[mdi--github] h-3.5 w-3.5" />
								{t("sources.trigger")}
							</Button>
							<Button variant="ghost" size="sm" disabled={model.refreshing} onClick={model.refresh}>
								<span
									className={`icon-[solar--refresh-linear] h-3.5 w-3.5 ${model.refreshing ? "animate-spin" : ""}`}
								/>
								{t("actions.refresh")}
							</Button>
							<div data-tour="capabilities-scope">
								<SegmentedControl
									items={[
										{ key: "discover" as AbilityScope, label: t("scope.discover") },
										{ key: "mine" as AbilityScope, label: t("scope.mine") },
									]}
									value={model.scope}
									onChange={model.setScope}
								/>
							</div>
						</div>
					</div>

					{model.errors.length > 0 && (
						<div className="flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[12px] text-muted-foreground/70">
							<span className="icon-[solar--info-circle-linear] mt-0.5 h-3.5 w-3.5 shrink-0" />
							<span>{t("error.partial", { error: model.errors.join(" / ") })}</span>
						</div>
					)}
					<div data-tour="capabilities-list">
						{model.loading ? (
							<div className="flex min-h-52 flex-col items-center justify-center gap-2 text-muted-foreground/60">
								<span className="icon-[solar--refresh-linear] h-8 w-8 animate-spin" />
								<span className="text-[12px]">{t("loading")}</span>
							</div>
						) : model.items.length === 0 ? (
							<div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-xl border border-border/50 bg-card/30 text-center">
								<span className="icon-[solar--magic-stick-3-linear] h-10 w-10 text-muted-foreground/50" />
								<div>
									<p className="text-[13px] font-semibold text-foreground">
										{hasActiveFilter
											? t("empty.noMatch")
											: model.scope === "discover" || (model.scope as string) === "public"
												? t("empty.discover")
												: t("empty.mine")}
									</p>
									<p className="mt-1 text-[11px] text-muted-foreground/60">
										{hasActiveFilter ? t("empty.noMatchHint") : t("empty.hint")}
									</p>
								</div>
							</div>
						) : (
							<div className="flex flex-col gap-6">
								{categorized ? (
									model.groups.map((group) => (
										<section key={group.category} className="flex flex-col gap-2">
											<div className="flex items-baseline gap-2">
												<h2 className="text-[13px] font-semibold text-foreground/90">
													{group.category === ABILITY_CATEGORY_UNCATEGORIZED
														? t("group.uncategorized")
														: group.category === ABILITY_CATEGORY_CONNECTORS
															? t("group.connectors")
															: group.category === ABILITY_CATEGORY_VETTA_BUILTIN
																? t("group.vettaBuiltin")
																: resolveCategoryLabel(group.category, group.categoryI18n, i18n.language)}
												</h2>
												<span className="text-[11px] tabular-nums text-muted-foreground/50">
													{group.items.length}
												</span>
											</div>
											<div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-x-3 gap-y-0.5">
												{group.items.map((item) => (
													<AbilityCard key={item.id} item={item} model={model} onUnreviewedMcpAdd={setUnreviewedMcp} />
												))}
											</div>
										</section>
									))
								) : (
									<div className="grid grid-cols-[repeat(auto-fill,minmax(min(260px,100%),1fr))] gap-x-3 gap-y-0.5">
										{model.items.map((item) => (
											<AbilityCard key={item.id} item={item} model={model} onUnreviewedMcpAdd={setUnreviewedMcp} />
										))}
									</div>
								)}
								{model.hasMore && (
									<div className="flex justify-center pt-2">
										<Button variant="secondary" size="sm" onClick={model.loadMore}>
											{t("actions.loadMore", { remaining: model.totalItems - model.items.length })}
										</Button>
									</div>
								)}
							</div>
						)}
					</div>
				</div>
			</div>

			<AbilityMcpDialogs mcp={model.mcp} />
			<UnreviewedMcpPromptDialog
				item={unreviewedMcp}
				open={unreviewedMcp !== null}
				onOpenChange={(open) => {
					if (!open) setUnreviewedMcp(null);
				}}
			/>
			{sourcesDialogOpen && (
				<MarketplaceSourcesDialog
					sources={model.marketplaceSources}
					catalog={model.marketplaceCatalog}
					refreshing={model.refreshing}
					onRefresh={model.refreshMarketplaceSource}
					onAdd={async (input) => {
						await model.addMarketplaceSource(input);
						model.setScope("discover");
					}}
					onUpdate={model.updateMarketplaceSource}
					onRemove={model.removeMarketplaceSource}
					onClearCredential={model.clearMarketplaceSourceCredential}
					onClose={() => setSourcesDialogOpen(false)}
				/>
			)}
			<CapabilitiesTour />
		</div>
	);
}
