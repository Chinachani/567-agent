import { pluginBlueprintId } from "@567agent/agent-team";
import { app } from "electron";
import type { ExpertPresetSourceStatus } from "../../preload/api-types/agent-teams.js";
import { isExpertPresetRepository } from "../abilities/open-marketplace/official-marketplace-source.js";
import { getOpenMarketplaceManager } from "../abilities/open-marketplace/open-marketplace-manager.js";
import { getAppLogger } from "../logger.js";
import { listPlugins, onPluginsChanged } from "../plugins/plugin-catalog.js";
import { agentBlueprintRegistry } from "./agent-blueprint-registry.js";
import { agentTeamStore } from "./agent-team-store.js";
import { type PluginPresetDeclarations, pluginTeamId } from "./plugin-agent-preset-reconcile.js";
import { type AgentPresetPackage, buildPluginAgentPresets } from "./plugin-agent-presets.js";

const log = getAppLogger("agent-teams");

let subscribed = false;
let marketplacePlugins: readonly AgentPresetPackage[] = [];

function allAgentPresetPlugins(): AgentPresetPackage[] {
	const plugins = new Map<string, AgentPresetPackage>(listPlugins().map((plugin) => [plugin.id, plugin] as const));
	for (const plugin of marketplacePlugins) {
		// A real installed artifact is authoritative if the user later installs
		// the same preset package from a published release.
		if (!plugins.has(plugin.id)) plugins.set(plugin.id, plugin);
	}
	return [...plugins.values()];
}

/** 按当前已启用的插件重建 blueprint 注册表。 */
export function refreshPluginAgentPresets(): boolean {
	try {
		const plugins = allAgentPresetPlugins();
		const { agents, teams } = buildPluginAgentPresets({ plugins, logger: log });
		agentBlueprintRegistry.replacePluginPresets(
			agents,
			teams,
			plugins.filter((plugin) => plugin.enabled && !plugin.presetSource).map((plugin) => plugin.id),
			{
				...collectPluginPresetDeclarations(plugins),
				marketplaceAuthoritative,
				// 1.6 preview builds used plugin ownership for this source-only package.
				protectedProviderIds: marketplaceAuthoritative ? undefined : new Set(["everyday-experts"]),
			},
		);
		log.debug?.("plugin agent presets refreshed", { agents: agents.length, teams: teams.length });
		return true;
	} catch (error) {
		// 读不出插件预设只该让插件智能体暂时缺席，不能连内置智能体一起拖垮。
		log.error("failed to refresh plugin agent presets", {
			error: error instanceof Error ? error.message : String(error),
		});
		return false;
	}
}

let marketplaceAuthoritative = false;
let syncTail: Promise<void> = Promise.resolve();
let sourceStatus: ExpertPresetSourceStatus = { phase: "idle", syncedAt: null, count: 0, hasCache: false };
const statusListeners = new Set<() => void>();
export function getExpertPresetSourceStatus(): ExpertPresetSourceStatus {
	return sourceStatus;
}
export function onExpertPresetSourceChanged(listener: () => void): () => void {
	statusListeners.add(listener);
	return () => statusListeners.delete(listener);
}
function publishStatus(status: ExpertPresetSourceStatus): void {
	sourceStatus = status;
	for (const listener of statusListeners) {
		try {
			listener();
		} catch {
			log.warn("expert source status listener failed");
		}
	}
}

/** Serialized reads and application prevent an older request replacing newer declarations. */
export function refreshMarketplaceAgentPresets(mode: "cached" | "auto" | "refresh" = "refresh"): Promise<void> {
	const operation = syncTail.then(async () => {
		publishStatus({ ...sourceStatus, phase: "syncing" });
		try {
			const result = await getOpenMarketplaceManager(app.getVersion()).readExpertPresets(mode);
			const enabled = result.source?.enabled === true;
			const previousPlugins = marketplacePlugins;
			const previousAuthority = marketplaceAuthoritative;
			if (result.packages !== undefined) {
				marketplacePlugins = result.packages;
				marketplaceAuthoritative = enabled;
			} else if (!enabled) {
				marketplacePlugins = marketplacePlugins.map((item) => ({ ...item, enabled: false }));
				marketplaceAuthoritative = false;
			}
			if (!refreshPluginAgentPresets()) {
				marketplacePlugins = previousPlugins;
				marketplaceAuthoritative = previousAuthority;
				throw new Error("Expert snapshot could not be rebuilt");
			}
			await agentTeamStore.syncPluginPresets();
			const hasCache = result.snapshot?.marketplaceVersion != null || marketplacePlugins.length > 0;
			publishStatus({
				phase: !enabled ? "disabled" : result.snapshot?.error ? "error" : result.packages ? "ready" : "idle",
				sourceId: result.source?.id,
				sourceName: result.source?.name,
				syncedAt: result.snapshot?.syncedAt ?? sourceStatus.syncedAt,
				count: marketplacePlugins.reduce((sum, item) => sum + (item.agent?.agents?.length ?? 0), 0),
				hasCache,
				error: result.snapshot?.error,
			});
		} catch (error) {
			log.warn("failed to refresh marketplace agent presets", {
				error: error instanceof Error ? error.message : String(error),
			});
			publishStatus({ ...sourceStatus, phase: "error", error: "sync-failed" });
		}
	});
	syncTail = operation.catch(() => undefined);
	return operation;
}

/**
 * 收齐**已安装**插件声明过的预设标识——禁用的也算。
 *
 * 这是清理残骸唯一的判据：清单里不再声明的团队才该消失，用户临时禁用插件不该让它的资产被当成
 * 残骸清掉。历史 id 一并收进来，否则被接管过的存量资源会在下一次同步里被误判。
 */
export function collectPluginPresetDeclarations(plugins: readonly AgentPresetPackage[]): PluginPresetDeclarations {
	const agentBlueprintIds = new Set<string>();
	const teamIds = new Set<string>();
	for (const plugin of plugins) {
		for (const agent of plugin.agent?.agents ?? []) {
			agentBlueprintIds.add(pluginBlueprintId(plugin.id, agent.id));
			for (const legacy of agent.legacyIds ?? []) agentBlueprintIds.add(legacy);
		}
		for (const team of plugin.agent?.teams ?? []) {
			teamIds.add(pluginTeamId(plugin.id, team.id));
			for (const legacy of team.legacyIds ?? []) teamIds.add(legacy);
		}
	}
	return { agentBlueprintIds, teamIds };
}

/**
 * 建立「插件变更 → 重建 blueprint → 重铺用户配置」的订阅，并立即跑一次。
 *
 * 必须早于第一次读 Agent 配置：装机目录回填要按当前可用的插件 blueprint 决定铺什么，
 * 注册表是空的就等于所有插件智能体都「不可用」。
 *
 * 第二步（重铺配置）不能省：注册表只是主进程的一张解析表，用户看到的智能体与团队来自已经读进
 * 内存的那份配置文档。热重载时只刷注册表，侧边栏会一直停在旧阵容直到重启 App。
 */
export function initPluginAgentPresetSync(): void {
	if (subscribed) return;
	subscribed = true;
	onPluginsChanged(() => {
		// Local plugin availability must not wait behind a slow repository request.
		if (refreshPluginAgentPresets())
			void agentTeamStore.syncPluginPresets().catch((error) => {
				log.warn("failed to apply plugin presets", {
					error: error instanceof Error ? error.message : String(error),
				});
			});
	});
	const manager = getOpenMarketplaceManager(app.getVersion());
	manager.subscribeToUpdates((sourceId) => {
		if (
			sourceId === sourceStatus.sourceId ||
			manager.listSources().some((source) => source.id === sourceId && isExpertPresetRepository(source.repository))
		) {
			void refreshMarketplaceAgentPresets("cached");
		}
	});
	refreshPluginAgentPresets();
	void refreshMarketplaceAgentPresets("cached").then(() => refreshMarketplaceAgentPresets("auto"));
}
