import { SegmentedControl } from "@vetta-org/theme-ui/shared";
import { Button, Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@vetta-org/ui";
import { motion } from "motion/react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CapabilitiesTour } from "@shared/tour";
import { SettingsAiAssist } from "../../settings/ai-assist";
import { resolveCategoryLabel } from "../lib/ability-presentation";
import {
	ABILITY_CATEGORY_CONNECTORS,
	ABILITY_CATEGORY_UNCATEGORIZED,
	ABILITY_CATEGORY_VETTA_BUILTIN,
	ENABLE_ABILITY_CATEGORIES,
	type AbilitiesModel,
	type AbilityScope,
} from "../types";
import { AbilitiesBanner } from "./AbilitiesBanner";
import { AbilityCard } from "./AbilityCard";
import { AbilityMcpDialogs } from "./AbilityMcpDialogs";
import { AddAbilityMenu } from "./AddAbilityMenu";
import { MarketplaceSourcesDialog } from "./MarketplaceSourcesDialog";

const easeOut = [0.22, 1, 0.36, 1] as const;
const MCP_CATEGORY_LABEL_KEYS = {
	"ai-agents": "mcp.categories.ai-agents",
	automation: "mcp.categories.automation",
	"cad-3d": "mcp.categories.cad-3d",
	communication: "mcp.categories.communication",
	"creative-media": "mcp.categories.creative-media",
	"data-databases": "mcp.categories.data-databases",
	"developer-tools": "mcp.categories.developer-tools",
	"knowledge-memory": "mcp.categories.knowledge-memory",
	productivity: "mcp.categories.productivity",
	"system-tools": "mcp.categories.system-tools",
	"web-search": "mcp.categories.web-search",
} as const;
const MCP_TAG_LABEL_KEYS = {
	"3d-modeling": "mcp.tags.3d-modeling", ai: "mcp.tags.ai", automation: "mcp.tags.automation",
	browser: "mcp.tags.browser", cad: "mcp.tags.cad", cloud: "mcp.tags.cloud",
	communication: "mcp.tags.communication", "data-analysis": "mcp.tags.data-analysis", database: "mcp.tags.database",
	documents: "mcp.tags.documents", email: "mcp.tags.email", filesystem: "mcp.tags.filesystem",
	finance: "mcp.tags.finance", "image-generation": "mcp.tags.image-generation", "issue-tracking": "mcp.tags.issue-tracking",
	memory: "mcp.tags.memory", maps: "mcp.tags.maps", search: "mcp.tags.search", security: "mcp.tags.security",
	"developer-tools": "mcp.tags.developer-tools", "video-generation": "mcp.tags.video-generation",
	blender: "mcp.tags.blender", freecad: "mcp.tags.freecad", solidworks: "mcp.tags.solidworks", git: "mcp.tags.git",
} as const;

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
	const [tagsPopoverOpen, setTagsPopoverOpen] = useState(false);
	const hasActiveFilters = Boolean(model.searchQuery || model.selectedCategory || model.selectedTags.length > 0);
	const categoryLabel = (value: string): string => {
		if (value === ABILITY_CATEGORY_UNCATEGORIZED || value === "uncategorized") return t("group.uncategorized");
		const key = MCP_CATEGORY_LABEL_KEYS[value as keyof typeof MCP_CATEGORY_LABEL_KEYS];
		return key ? t(key) : value;
	};
	const tagLabel = (value: string): string => {
		const key = MCP_TAG_LABEL_KEYS[value as keyof typeof MCP_TAG_LABEL_KEYS];
		return key ? t(key) : value;
	};
	const toggleTag = (tag: string): void => {
		model.setSelectedTags(
			model.selectedTags.includes(tag)
				? model.selectedTags.filter((value) => value !== tag)
				: [...model.selectedTags, tag],
		);
	};

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

			<div className="relative shrink-0 px-8 pb-4">
				<motion.div
					className="mx-auto flex w-full max-w-5xl items-end justify-between gap-4"
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

			<div className="flex-1 overflow-y-auto px-8 pt-5 pb-8 [scrollbar-gutter:stable]">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
					<AbilitiesBanner icons={model.bannerIcons} />

					<div className="flex flex-wrap items-center justify-between gap-3">
						<div data-tour="capabilities-search-add" className="flex min-w-0 flex-wrap items-center gap-2">
							<div className="relative w-56 shrink-0">
								<span className="icon-[solar--magnifer-linear] absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
								<input
									type="text"
									placeholder={t("search.placeholder")}
									value={model.searchQuery}
									onChange={(event) => model.setSearchQuery(event.target.value)}
									className="h-8 w-full rounded-lg bg-secondary pl-8 pr-3 text-[12px] text-foreground placeholder:text-muted-foreground/40 transition-colors hover:bg-accent focus:bg-accent focus:outline-none"
								/>
							</div>
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
						<div className="flex items-center gap-2">
							{model.scope === "discover" && (model.availableCategories.length > 0 || model.availableTags.length > 0) ? (
								<>
									<Select
										value={model.selectedCategory || "__all_categories__"}
										onValueChange={(value) => model.setSelectedCategory(value === "__all_categories__" ? "" : value)}
									>
										<SelectTrigger aria-label={t("filters.category")} className="h-8 w-44 text-[12px]">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="__all_categories__">{t("filters.allCategories")}</SelectItem>
											{model.availableCategories.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{categoryLabel(option.value)} ({option.count})
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<Popover open={tagsPopoverOpen} onOpenChange={setTagsPopoverOpen}>
										<PopoverTrigger asChild>
											<Button variant="secondary" size="sm" aria-label={t("filters.tags")}>
												{t("filters.tags")}{model.selectedTags.length ? ` (${model.selectedTags.length})` : ""}
											</Button>
										</PopoverTrigger>
										<PopoverContent align="start" className="max-h-72 w-64 gap-1 overflow-y-auto p-2">
											<p className="px-2 pb-1 text-[11px] font-medium text-muted-foreground">{t("filters.tags")}</p>
											{model.availableTags.map((option) => (
												<label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] hover:bg-accent">
													<input
														type="checkbox"
														checked={model.selectedTags.includes(option.value)}
														onChange={() => toggleTag(option.value)}
														className="accent-primary"
													/>
													<span className="min-w-0 flex-1 truncate">{tagLabel(option.value)}</span>
													<span className="tabular-nums text-muted-foreground">{option.count}</span>
												</label>
											))}
										</PopoverContent>
									</Popover>
									{(model.selectedCategory || model.selectedTags.length > 0) && (
										<Button variant="ghost" size="sm" onClick={model.clearFilters}>{t("filters.clear")}</Button>
									)}
								</>
							) : null}
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
										{hasActiveFilters
											? t("empty.noMatch")
											: model.scope === "discover" || (model.scope as string) === "public"
												? t("empty.discover")
												: t("empty.mine")}
									</p>
									<p className="mt-1 text-[11px] text-muted-foreground/60">
										{hasActiveFilters ? t("empty.noMatchHint") : t("empty.hint")}
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
											<div className="grid grid-cols-2 gap-x-3 gap-y-0.5 lg:grid-cols-3">
												{group.items.map((item) => (
													<AbilityCard key={item.id} item={item} model={model} />
												))}
											</div>
										</section>
									))
								) : (
									<div className="grid grid-cols-2 gap-x-3 gap-y-0.5 lg:grid-cols-3">
										{model.items.map((item) => (
											<AbilityCard key={item.id} item={item} model={model} />
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
