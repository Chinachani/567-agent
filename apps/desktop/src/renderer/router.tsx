import { createRootRoute, createRoute, createRouter, createHashHistory, redirect } from "@tanstack/react-router";
import { RouteContentLoadingView } from "@vetta-org/theme-ui/app";
import { RootLayout } from "./App";
import {
	loadAbilitiesPage,
	loadAgentCenterPage,
	loadAutomationPage,
	loadBatchTasksPage,
	loadKnowledgeBasePage,
	loadNewSessionPage,
	loadPluginWorkspaceViewRoute,
	loadSettingsPage,
	loadUsageLogPage,
} from "./route-page-loaders";
import { RouteErrorPage } from "./shared/components/RouteErrorPage";
import { lazyRoutePage } from "./shared/lib/lazy-route-page";
import { PLUGIN_HOSTED_ROUTE_PATH, THEME_HOSTED_ROUTE_PATH } from "./shared/hosted-routes/hosted-route-descriptors";

const ChatPage = lazyRoutePage("ChatPage", async () => ({
	default: (await import("./domains/conversation/components/ChatPage")).ChatPage,
}));
const NewSessionPage = lazyRoutePage("NewSessionPage", loadNewSessionPage);
const SessionViewerPage = lazyRoutePage("SessionViewerPage", async () => ({
	default: (await import("./domains/conversation/components/SessionViewerPage")).SessionViewerPage,
}));
const AutomationPage = lazyRoutePage("AutomationPage", loadAutomationPage);
const BatchTasksPage = lazyRoutePage("BatchTasksPage", loadBatchTasksPage);
const AbilitiesPage = lazyRoutePage("AbilitiesPage", loadAbilitiesPage);
const AgentCenterPage = lazyRoutePage("AgentCenterPage", loadAgentCenterPage);
const LegacyTeamHistoryRedirect = lazyRoutePage("LegacyTeamHistoryRedirect", async () => ({
	default: (await import("./domains/agent-teams/components/LegacyTeamHistoryRedirect")).LegacyTeamHistoryRedirect,
}));
const SettingsPage = lazyRoutePage("SettingsPage", loadSettingsPage);
const ProjectDetailPage = lazyRoutePage("ProjectDetailPage", async () => ({
	default: (await import("./domains/project/components/ProjectDetailPage")).ProjectDetailPage,
}));
const KnowledgeBasePage = lazyRoutePage("KnowledgeBasePage", loadKnowledgeBasePage);
const KnowledgeBaseListPage = lazyRoutePage("KnowledgeBaseListPage", async () => ({
	default: (await import("./domains/knowledge-base/components/KnowledgeBaseListPage")).KnowledgeBaseListPage,
}));
const PluginWorkspaceViewRoute = lazyRoutePage("PluginWorkspaceViewRoute", loadPluginWorkspaceViewRoute);
const ThemePageRoute = lazyRoutePage("ThemePageRoute", async () => ({
	default: (await import("./shared/theme/pages/ThemePageRoute")).ThemePageRoute,
}));
const UsageLogPage = lazyRoutePage("UsageLogPage", loadUsageLogPage);

const rootRoute = createRootRoute({
	component: RootLayout,
});

const indexRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/",
	component: ChatPage,
});

/** 设置 / 自动化 / 批量任务不显示切页骨架：pending 期间留空白，内容就绪后直出。 */
const NoPendingComponent = (): null => null;

const automationRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/automation",
	component: AutomationPage,
	pendingComponent: NoPendingComponent,
});

const batchTasksRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/batch-tasks",
	component: BatchTasksPage,
	pendingComponent: NoPendingComponent,
});

/**
 * 能力详情是页内右侧抽屉，由来源感知的 `?detail=<catalog-id>` 驱动（返回键即关闭）。
 * `?q=` 是外部深链带进来的搜索词初值，`?scope=` 是落地时选中的分区（Command Menu
 * 用它把「已装能力」送进「我的」而不是「发现」）。两者只作为初值播种，之后由页面
 * 自身状态接管，不做双向同步。
 */
const abilitiesRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/abilities",
	component: AbilitiesPage,
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.detail === "string" ? { detail: search.detail } : {}),
		...(typeof search.q === "string" && search.q ? { q: search.q } : {}),
		...(search.scope === "mine" || search.scope === "discover" ? { scope: search.scope } : {}),
	}),
});

const agentCenterRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agents",
	component: AgentCenterPage,
	pendingComponent: NoPendingComponent,
	// 专家详情与复制草稿通过 search 驱动，返回键关闭抽屉。
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.agent === "string" ? { agent: search.agent } : {}),
		...(typeof search.copy === "string" ? { copy: search.copy } : {}),
		...(typeof search.cwd === "string" ? { cwd: search.cwd } : {}),
		...(search.tab === "experts" || search.tab === "collaboration"
			? { tab: search.tab }
			: search.tab === "legacy-teams" || typeof search.team === "string"
				? { tab: "collaboration" as const }
				: {}),
	}),
});

/** 旧的团队列表页已并入智能体中心，深链保持可用。 */
const teamListRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams",
	beforeLoad: () => {
		throw redirect({ to: "/agents", search: { tab: "collaboration" }, replace: true });
	},
});

const teamChatRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId",
	component: LegacyTeamHistoryRedirect,
	pendingComponent: NoPendingComponent,
});

const teamSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId/sessions/$sessionId",
	component: LegacyTeamHistoryRedirect,
	pendingComponent: NoPendingComponent,
});

const teamNewSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId/new",
	beforeLoad: () => {
		throw redirect({ to: "/agents", search: { tab: "collaboration" }, replace: true });
	},
});

const teamMemberSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId/sessions/$sessionId/members/$memberId",
	component: LegacyTeamHistoryRedirect,
	pendingComponent: NoPendingComponent,
});

/** 已撤下的团队设置深链进入现有项目协作。 */
const teamSettingsRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/agent-teams/$teamId/settings",
	beforeLoad: () => {
		throw redirect({ to: "/agents", search: { tab: "collaboration" }, replace: true });
	},
});

/** 旧深链：曾经的独立详情页改为能力页抽屉。 */
const abilityDetailRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/abilities/$type/$slug",
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/abilities",
			search: { detail: `${params.type}:${params.slug}` },
			replace: true,
		});
	},
});

/** 旧深链：/skills 一律并入能力页（ADR-0049）。 */
const skillsRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/skills",
	beforeLoad: () => {
		throw redirect({ to: "/abilities", replace: true });
	},
});

const scenesRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/scenes",
	beforeLoad: () => {
		throw redirect({ to: "/abilities", replace: true });
	},
});

const pluginsRedirectRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/plugins",
	beforeLoad: () => {
		throw redirect({ to: "/abilities", replace: true });
	},
});

const knowledgeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/knowledge",
	component: KnowledgeBasePage,
});

const knowledgeListRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/knowledge/all",
	component: KnowledgeBaseListPage,
});

const settingsTabRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/settings/$tab",
	component: SettingsPage,
	pendingComponent: NoPendingComponent,
	validateSearch: (search: Record<string, unknown>) => {
		const section = typeof search.section === "string" ? search.section : undefined;
		const h2 = typeof search.h2 === "string" ? search.h2 : undefined;
		const nav = typeof search.nav === "string" ? search.nav : undefined;
		// `<pluginId>/<viewId>`：设置壳内嵌打开某个插件工作区视图（ADR-0105）。
		const view = typeof search.view === "string" ? search.view : undefined;
		const modelSource =
			search.modelSource === "api567" || search.modelSource === "presets" || search.modelSource === "local"
				? search.modelSource
				: undefined;
		return {
			...(section ? { section } : {}),
			...(h2 ? { h2 } : {}),
			...(nav ? { nav } : {}),
			...(view ? { view } : {}),
			...(modelSource ? { modelSource } : {}),
		};
	},
});

const projectDetailRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/project/$cwd",
	component: ProjectDetailPage,
});

const newSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/new-session",
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.cwd === "string" ? { cwd: search.cwd } : {}),
		...(typeof search.target === "string" ? { target: search.target } : {}),
	}),
	component: NewSessionPage,
	beforeLoad: ({ search }) => {
		if (search.target?.startsWith("team:"))
			throw redirect({
				to: "/agents",
				search: { tab: "collaboration", ...(search.cwd ? { cwd: search.cwd } : {}) },
				replace: true,
			});
	},
});

const legacyNewSessionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/new-session/$cwd",
	beforeLoad: ({ params }) => {
		let cwd = params.cwd;
		try {
			cwd = decodeURIComponent(params.cwd);
		} catch {}
		throw redirect({ to: "/new-session", search: { cwd } });
	},
});

const sessionViewerRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/viewer/$path",
	component: SessionViewerPage,
	validateSearch: (search: Record<string, unknown>) => ({
		...(search.origin === "subagent" || search.origin === "team" ? { origin: search.origin } : {}),
		...(typeof search.teamSession === "string" ? { teamSession: search.teamSession } : {}),
	}),
});

const themePageRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: THEME_HOSTED_ROUTE_PATH,
	component: ThemePageRoute,
});

/** 插件工作区视图整页路由（`/workspace/$pluginId/$viewId`）。 */
const pluginWorkspaceViewRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: PLUGIN_HOSTED_ROUTE_PATH,
	component: PluginWorkspaceViewRoute,
	pendingComponent: NoPendingComponent,
});

const usageRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/usage",
	component: UsageLogPage,
	pendingComponent: NoPendingComponent,
	validateSearch: (search: Record<string, unknown>) => ({
		...(typeof search.sessionId === "string" ? { sessionId: search.sessionId } : {}),
		...(typeof search.group === "string" ? { group: search.group } : {}),
		...(typeof search.model === "string" ? { model: search.model } : {}),
	}),
});

const routeTree = rootRoute.addChildren([
	indexRoute,
	automationRoute,
	batchTasksRoute,
	agentCenterRoute,
	teamListRedirectRoute,
	teamChatRoute,
	teamNewSessionRoute,
	teamSessionRoute,
	teamMemberSessionRoute,
	teamSettingsRedirectRoute,
	knowledgeRoute,
	knowledgeListRoute,
	abilitiesRoute,
	abilityDetailRedirectRoute,
	skillsRedirectRoute,
	scenesRedirectRoute,
	pluginsRedirectRoute,
	settingsTabRoute,
	projectDetailRoute,
	newSessionRoute,
	legacyNewSessionRoute,
	sessionViewerRoute,
	pluginWorkspaceViewRoute,
	themePageRoute,
	usageRoute,
]);

export const router = createRouter({
	routeTree,
	history: createHashHistory(),
	defaultNotFoundComponent: ChatPage,
	defaultErrorComponent: RouteErrorPage,
	defaultPendingComponent: RouteContentLoadingView,
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
