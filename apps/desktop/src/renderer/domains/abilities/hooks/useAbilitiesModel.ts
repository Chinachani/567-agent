/**
 * 能力页统一模型：数据源（useAbilityData）+ 操作层（useAbilityActions）+ 搜索过滤。
 * 五种 type 共用同一份条目集合，列表页与详情页都从这里取。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	discoveryRecordMatches,
	emptyDiscoveryFacets,
	MCP_DISCOVERY_CATEGORIES,
	MCP_DISCOVERY_FACETS,
	type McpDiscoveryFilters,
	type McpDiscoveryQuery,
} from "../../../../shared/mcp-discovery";
import { usePluginTextResolver } from "../../plugins/runtime/plugin-i18n";
import { useMcpSettingsModel } from "../../settings/components/useMcpSettingsModel";
import { filterAbilityCatalog, queryAbilityCatalog } from "../lib/ability-catalog-query";
import { abilityCategoryKey, normalizeAbilityCategory } from "../lib/ability-categories";
import { localizeMarketAbility } from "../lib/ability-presentation";
import {
	buildBundleAbilities,
	buildMcpAbilities,
	buildPluginAbilities,
	buildSkillAbilities,
	type LocalAbilityState,
} from "../lib/build-ability-items";
import { decorateAbilityConflicts } from "../lib/decorate-ability-conflicts";
import { groupAbilities } from "../lib/group-abilities";
import { withLocalAbilityPresentation } from "../lib/local-ability-presentation";
import { toMarketAbility } from "../lib/merge-ability-catalogs";
import {
	ABILITY_CATEGORY_INSTALLED,
	type AbilitiesModel,
	type AbilityGroup,
	type AbilityItem,
	type AbilityReviewFilter,
	type AbilityScope,
} from "../types";
import { useAbilityActions } from "./useAbilityActions";
import { useAbilityData } from "./useAbilityData";
import { useDiscoverySearch } from "./useDiscoverySearch";

const ABILITY_PAGE_SIZE = 60;

export interface UseAbilitiesModelOptions {
	/** 深链带进来的搜索词初值；只播种一次，之后由页面状态接管。 */
	readonly initialSearchQuery?: string;
	/** 深链指定的落地分区；缺省仍是「发现」。 */
	readonly initialScope?: AbilityScope;
}

export function useAbilitiesModel(options: UseAbilitiesModelOptions = {}): AbilitiesModel {
	const { t, i18n } = useTranslation("settings");
	const [scope, setScope] = useState<AbilityScope>(options.initialScope ?? "discover");
	const [searchQuery, setSearchQuery] = useState(options.initialSearchQuery ?? "");
	const [typeFilter, setTypeFilter] = useState<AbilityItem["type"] | "">("");
	const [category, setCategory] = useState("");
	const [reviewFilter, setReviewFilter] = useState<AbilityReviewFilter>("all");
	const [tagFilter, setTagFilter] = useState("");
	const [discoveryFilters, setDiscoveryFilters] = useState<McpDiscoveryFilters>({});
	const [visiblePages, setVisiblePages] = useState(1);

	const data = useAbilityData();
	const trPlugin = usePluginTextResolver();
	const discoveryCategory = category === "__uncategorized__" ? "uncategorized" : category;
	const supportedCategory = MCP_DISCOVERY_CATEGORIES.find((value) => value === discoveryCategory);
	const discoveryEnabled =
		(scope === "discover" || scope === "public") &&
		(!typeFilter || typeFilter === "mcp") &&
		(!category || Boolean(supportedCategory));
	const discoveryQuery = useMemo<Omit<McpDiscoveryQuery, "offset" | "limit">>(
		() => ({
			keyword: searchQuery,
			category: supportedCategory,
			filters: { ...discoveryFilters, ...(tagFilter ? { tags: [tagFilter] } : {}) },
		}),
		[searchQuery, supportedCategory, discoveryFilters, tagFilter],
	);
	const discovery = useDiscoverySearch(data.marketplaceCatalog.snapshots, discoveryQuery, discoveryEnabled);
	const discoveryFacets = useMemo(() => {
		const facets = emptyDiscoveryFacets();
		for (const snapshot of data.marketplaceCatalog.snapshots)
			for (const [name, info] of Object.entries(snapshot.discovery?.categories ?? {})) {
				if (supportedCategory && name !== supportedCategory) continue;
				for (const key of MCP_DISCOVERY_FACETS)
					for (const [value, count] of Object.entries(info.facets[key]))
						facets[key][value] = (facets[key][value] ?? 0) + count;
			}
		return facets;
	}, [data.marketplaceCatalog.snapshots, supportedCategory]);
	const hasV2 = discovery.sources.length > 0;
	const discoveryMarket = useMemo(
		() =>
			discovery.results.flatMap((result) => {
				const source = data.marketplaceCatalog.snapshots.find((snapshot) => snapshot.sourceId === result.sourceId);
				return source
					? result.abilities.map((ability) =>
							localizeMarketAbility(toMarketAbility(ability, source), i18n.language),
						)
					: [];
			}),
		[discovery.results, data.marketplaceCatalog.snapshots, i18n.language],
	);
	// 引导弹窗里完成的安装不走 useAbilityActions，台账要由 mcp 模型回调刷新，
	// 否则卡片继续显示「添加」，再点一次就会装出第二个同名 server。
	const mcp = useMcpSettingsModel({ onAbilityLedgerChanged: data.refresh });
	const actions = useAbilityActions({
		mcp,
		refresh: data.refresh,
		refreshLocalInstallState: data.refreshLocalInstallState,
	});

	const localState = useMemo<LocalAbilityState>(
		() => ({
			ledger: data.ledger,
			mcpSetupStatus: data.mcpSetupStatus,
			skillManifest: data.skillManifest,
			localSkills: data.localSkills,
			plugins: data.plugins,
			mcpConfig: mcp.config,
			oauthAuthByName: mcp.oauthAuthByName,
			busyIds: actions.busyIds,
		}),
		[
			actions.busyIds,
			data.ledger,
			data.localSkills,
			data.mcpSetupStatus,
			data.plugins,
			data.skillManifest,
			mcp.config,
			mcp.oauthAuthByName,
		],
	);

	// 市场行先按界面语言归一（name / description / tags 取 detail.i18n[locale] 覆盖），
	// 再喂给组装函数：卡片、搜索词、分组、详情页头部由此一并跟随语言。
	const market = useMemo(
		() => data.market.map((entry) => localizeMarketAbility(entry, i18n.language)),
		[data.market, i18n.language],
	);

	const allItems = useMemo<AbilityItem[]>(() => {
		const singles = [
			...buildSkillAbilities(market, localState),
			...buildMcpAbilities([...market, ...discoveryMarket], localState, t),
			...buildPluginAbilities(market, localState, trPlugin),
		]
			.map((item) => withLocalAbilityPresentation(item, data.localPresentations))
			.map((item) => ({
				...item,
				operation: actions.operationById.get(item.id),
				operationProgress: actions.operationProgressById.get(item.id),
			}));
		return decorateAbilityConflicts([...singles, ...buildBundleAbilities(market, singles, localState, t)]).map(
			(item) => ({
				...item,
				operation: actions.operationById.get(item.id),
				operationProgress: actions.operationProgressById.get(item.id),
			}),
		);
	}, [
		market,
		discoveryMarket,
		localState,
		t,
		trPlugin,
		data.localPresentations,
		actions.operationById,
		actions.operationProgressById,
	]);

	const changeScope = useCallback((nextScope: AbilityScope) => {
		setScope(nextScope);
		setDiscoveryFilters({});
		setTypeFilter("");
		setCategory("");
		setReviewFilter("all");
		setTagFilter("");
		setVisiblePages(1);
	}, []);
	const changeSearchQuery = useCallback((value: string) => {
		setSearchQuery(value);
		setVisiblePages(1);
	}, []);
	const changeCategory = useCallback((value: string) => {
		setCategory(value);
		setVisiblePages(1);
	}, []);
	const changeReviewFilter = useCallback((value: AbilityReviewFilter) => {
		setReviewFilter(value);
		setVisiblePages(1);
	}, []);
	const changeTagFilter = useCallback((value: string) => {
		setTagFilter(value);
		setVisiblePages(1);
	}, []);
	const changeTypeFilter = useCallback((value: AbilityItem["type"] | "") => {
		setTypeFilter(value);
		setVisiblePages(1);
	}, []);

	const facetItems = useMemo(
		() =>
			filterAbilityCatalog(
				allItems.filter((item) => !item.market?.discoveryReference),
				{ scope, keyword: searchQuery },
			),
		[allItems, scope, searchQuery],
	);
	const filterFacetItems = useMemo(
		() =>
			category === ABILITY_CATEGORY_INSTALLED
				? allItems.filter(
						(item) =>
							item.installed &&
							(!searchQuery.trim() ||
								item.searchTerms.some((term) => term.toLowerCase().includes(searchQuery.trim().toLowerCase()))),
					)
				: facetItems,
		[allItems, category, facetItems, searchQuery],
	);
	const availableTypes = useMemo(
		() =>
			(["mcp", "skill", "plugin", "bundle"] as const).filter(
				(type) =>
					filterFacetItems.some((item) => item.type === type) || (type === "mcp" && hasV2 && scope === "discover"),
			),
		[filterFacetItems, hasV2, scope],
	);
	const categories = useMemo(() => {
		const groups = groupAbilities(
			facetItems.filter(
				(item) =>
					(!typeFilter || item.type === typeFilter) &&
					(reviewFilter !== "unreviewed" || item.reviewStatus === "unreviewed") &&
					(!tagFilter || item.tags.includes(tagFilter)),
			),
		);
		if (scope === "discover" && (!typeFilter || typeFilter === "mcp")) {
			for (const snapshot of discovery.sources)
				for (const name of Object.keys(snapshot.discovery?.categories ?? {})) {
					const key = normalizeAbilityCategory(name);
					if (!groups.some((group) => group.category === key))
						groups.push({
							category: key,
							categoryI18n: {
								[i18n.language]: i18n.t(
									`abilities:discoveryV2.categories.${MCP_DISCOVERY_CATEGORIES.find((value) => value === name) ?? "uncategorized"}`,
								),
							},
							items: [],
						});
				}
		}
		return groups;
	}, [facetItems, typeFilter, reviewFilter, tagFilter, scope, discovery.sources, i18n.language, i18n.t]);
	const availableTags = useMemo(
		() =>
			Array.from(
				new Map(
					[
						...filterFacetItems
							.filter(
								(item) =>
									(!typeFilter || item.type === typeFilter) &&
									(!category ||
										category === ABILITY_CATEGORY_INSTALLED ||
										abilityCategoryKey(item) === category) &&
									(reviewFilter !== "unreviewed" || item.reviewStatus === "unreviewed"),
							)
							.flatMap((item) => item.tags),
						...(scope === "discover" && (!typeFilter || typeFilter === "mcp")
							? Object.keys(discoveryFacets.tags)
							: []),
					]
						.map((tag) => [tag.trim().toLocaleLowerCase(), tag.trim()] as const)
						.filter(([key, value]) => key && value),
				).values(),
			).sort((a, b) => a.localeCompare(b, i18n.language)),
		[filterFacetItems, typeFilter, category, reviewFilter, i18n.language, scope, discoveryFacets],
	);
	useEffect(() => {
		if (data.loading) return;
		if (typeFilter && !availableTypes.includes(typeFilter)) {
			setTypeFilter("");
			setCategory("");
			setVisiblePages(1);
		} else if (
			category &&
			category !== ABILITY_CATEGORY_INSTALLED &&
			!categories.some((group) => group.category === category)
		) {
			setCategory("");
			setVisiblePages(1);
		}
		if (tagFilter && !availableTags.some((tag) => tag.toLocaleLowerCase() === tagFilter.toLocaleLowerCase())) {
			setTagFilter("");
			setVisiblePages(1);
		}
	}, [availableTypes, availableTags, categories, category, tagFilter, typeFilter, data.loading]);

	const catalogPage = useMemo(
		() =>
			queryAbilityCatalog(
				allItems.filter(
					(item) =>
						!item.market?.discoveryReference &&
						(!Object.values(discoveryFilters).some((values) => values?.length) ||
							(item.market?.mcpMetadata &&
								discoveryRecordMatches(
									{ ...item.market, mcpMetadata: item.market.mcpMetadata },
									{ keyword: "", filters: discoveryFilters },
								))),
				),
				{
					scope,
					keyword: searchQuery,
					types: typeFilter ? [typeFilter] : undefined,
					category,
					reviewFilter,
					tag: tagFilter,
					page: 1,
					pageSize: visiblePages * ABILITY_PAGE_SIZE,
				},
			),
		[allItems, scope, searchQuery, typeFilter, category, reviewFilter, tagFilter, visiblePages, discoveryFilters],
	);
	const items = catalogPage.items;

	const groups = useMemo<AbilityGroup[]>(() => groupAbilities(items), [items]);

	const findById = useCallback(
		(id: string) => {
			const exact = allItems.find((item) => item.id === id);
			if (exact) return exact;
			const separator = id.indexOf(":");
			if (separator < 1) return null;
			const type = id.slice(0, separator);
			const slug = id.slice(separator + 1);
			const legacyMatches = allItems.filter((item) => item.type === type && item.slug === slug);
			return (
				legacyMatches.find((item) => item.installed) ??
				legacyMatches.find((item) => item.catalogSource.kind === "server") ??
				legacyMatches[0] ??
				null
			);
		},
		[allItems],
	);

	const errors = useMemo(
		() => Array.from(new Set([data.error, actions.error].filter((value): value is string => Boolean(value)))),
		[actions.error, data.error],
	);
	const detailErrors = useMemo(() => (actions.error ? [actions.error] : []), [actions.error]);

	return {
		discovery: hasV2
			? {
					items: allItems.filter((item) => Boolean(item.market?.discoveryReference)),
					facets: discoveryFacets,
					filters: discoveryFilters,
					setFilter: (facet, value) => setDiscoveryFilters((old) => ({ ...old, [facet]: value ? [value] : [] })),
					clearFilters: () => setDiscoveryFilters({}),
					active: discoveryEnabled,
					running: discovery.running,
					complete: discovery.complete,
					cancelled: discovery.cancelled,
					matched: discovery.matched,
					scanned: discovery.scanned,
					total: discovery.total,
					failed: discovery.failed,
					offset: discovery.offset,
					hasNext: discovery.hasNext,
					previous: discovery.previous,
					next: discovery.next,
					cancel: discovery.cancel,
					retry: discovery.retry,
				}
			: undefined,
		scope,
		setScope: changeScope,
		searchQuery,
		setSearchQuery: changeSearchQuery,
		typeFilter,
		availableTypes,
		setTypeFilter: changeTypeFilter,
		category,
		setCategory: changeCategory,
		reviewFilter,
		setReviewFilter: changeReviewFilter,
		tagFilter,
		setTagFilter: changeTagFilter,
		availableTags,
		categories,
		installedCount: allItems.filter((item) => item.installed).length,
		items,
		totalItems: catalogPage.total,
		hasMore: items.length < catalogPage.total,
		loadMore: () => setVisiblePages((current) => current + 1),
		groups,
		allItems,
		// mcpConfig 缺省时 buildMcpAbilities 按空表处理，不必再挡整表转圈。
		loading: data.loading,
		refreshing: data.refreshing,
		errors,
		detailErrors,
		importing: actions.importing,
		mcp,
		findById,
		refresh: data.refresh,
		refreshLocalInstallState: data.refreshLocalInstallState,
		install: actions.install,
		installBundleMembers: actions.installBundleMembers,
		uninstall: actions.uninstall,
		toggle: actions.toggle,
		setup: (item) => {
			// 安装后步骤（扫码登录等）不在客户端完成，只能把做法讲清楚。
			if (item.postInstallSetup) {
				actions.promptMcpSetup(item);
				return;
			}
			if (item.canConfigure && item.preset) {
				mcp.onConfigureBuiltinSecrets(item.serverName, item.preset);
				return;
			}
			if (item.usesOAuth && !item.authorized) void mcp.onAuthorizeOAuth(item.serverName);
		},
		configure: (item) => {
			// 声明了安装后步骤的能力，「配置」就是去完成那一步（扫码），
			// 可选参数留给「编辑配置」，不要再把用户送进一个与登录无关的凭证表单。
			if (item.postInstallSetup) {
				actions.promptMcpSetup(item);
				return;
			}
			mcp.onConfigureBuiltinSecrets(item.serverName, item.preset);
		},
		edit: (item) => mcp.onToggleEditServer(item.serverName),
		revokeAuthorization: (item) => {
			void mcp.onRevokeOAuth(item.serverName);
		},
		setPluginPermission: actions.setPluginPermission,
		applyPluginSetup: actions.applyPluginSetup,
		setPluginCommand: actions.setPluginCommand,
		reloadPlugin: actions.reloadPlugin,
		uninstallBundleMembers: actions.uninstallMembers,
		importSkillArchive: actions.importSkillArchive,
		importPluginArchive: actions.importPluginArchive,
		addMarketplaceSource: data.addMarketplaceSource,
		updateMarketplaceSource: data.updateMarketplaceSource,
		removeMarketplaceSource: data.removeMarketplaceSource,
		clearMarketplaceSourceCredential: data.clearMarketplaceSourceCredential,
		marketplaceSources: data.marketplaceSources,
		marketplaceCatalog: data.marketplaceCatalog,
		refreshMarketplaceSource: data.refreshMarketplaceSource,
		startAddManualMcp: () => mcp.onStartAddServer(),
		permissionPromptSlug: actions.permissionPromptSlug,
		pendingPluginSetup: actions.pendingPluginSetup,
		dismissPermissionPrompt: actions.dismissPermissionPrompt,
		setupPromptId: actions.setupPromptId,
		dismissSetupPrompt: actions.dismissSetupPrompt,
	};
}
