import type { PluginOfficialApi } from "@vetta-org/plugin-sdk";
import { createOfficialAgentApi } from "./plugin-official-agent";
import { createOfficialAppearanceApi } from "./plugin-official-appearance";
import { createOfficialBatchTasksApi } from "./plugin-official-batch-tasks";
import { createOfficialDialogApi } from "./plugin-official-dialog";
import { createOfficialDownloadsApi } from "./plugin-official-downloads";
import { createOfficialGeneralApi } from "./plugin-official-general";
import { createOfficialImApi } from "./plugin-official-im";
import { createOfficialKnowledgeApi } from "./plugin-official-knowledge";
import { createOfficialMcpApi } from "./plugin-official-mcp";
import { createOfficialModelsApi } from "./plugin-official-models";
import { createOfficialNavigationApi } from "./plugin-official-navigation";
import { createOfficialPluginsApi } from "./plugin-official-plugins";
import { createOfficialProjectsApi } from "./plugin-official-projects";
import { createOfficialSchedulerApi } from "./plugin-official-scheduler";
import { createOfficialSessionsApi } from "./plugin-official-sessions";
import { createOfficialShellApi } from "./plugin-official-shell";
import { createOfficialShortcutsApi } from "./plugin-official-shortcuts";
import { createOfficialSkillsApi } from "./plugin-official-skills";
import { createOfficialUpdaterApi } from "./plugin-official-updater";
import { createOfficialWebhookApi } from "./plugin-official-webhook";
import { pluginRendererCapabilityHost } from "./plugin-renderer-capability-host";

export function createPluginOfficialApi(capabilitySessionId: string): PluginOfficialApi {
	const assertOfficial = (): void => {
		pluginRendererCapabilityHost.assertOfficialSession(capabilitySessionId);
	};

	return {
		marketplace: {
			search: async ({ query, type, limit }) => {
				assertOfficial();
				const catalog = await window.vetta.abilities.listOpenMarketplaces();
				const normalizedQuery = query.trim().toLocaleLowerCase();
				const latinTerms = normalizedQuery.match(/[a-z0-9+#._-]+/g) ?? [];
				const cjkTerms = (normalizedQuery.match(/[\u3400-\u9fff]+/g) ?? [])
					.map((segment) =>
						segment.replace(
							/请帮我|帮我|找一下|找一个|推荐一个|推荐|我想|想要|可以|有没有|查找|搜索|能力|服务器/g,
							"",
						),
					)
					.filter(Boolean)
					.flatMap((segment) =>
						segment.length > 2
							? Array.from({ length: segment.length - 1 }, (_, index) => segment.slice(index, index + 2))
							: [segment],
					)
					.filter(
						(term) =>
							!["帮我", "找一", "一下", "一个", "推荐", "能力", "服务器", "有关", "相关", "可以"].includes(term),
					);
				const results = catalog.abilities
					.filter((ability) => !type || ability.type === type)
					.map((ability) => {
						const searchable = [
							ability.name,
							ability.slug,
							ability.description,
							ability.author,
							ability.category,
							ability.type,
							...ability.tags,
							...(ability.detail.meta ?? []).flatMap((item) => [item.label ?? "", item.value]),
							...(ability.detail.content ? [ability.detail.content] : []),
						]
							.join(" ")
							.toLocaleLowerCase();
						const matchingLatin = latinTerms.filter((term) => searchable.includes(term)).length;
						const matchingCjk = cjkTerms.filter((term) => searchable.includes(term)).length;
						if (matchingLatin !== latinTerms.length) return null;
						if (cjkTerms.length > 0 && matchingCjk === 0) return null;
						const score =
							(normalizedQuery && ability.name.toLocaleLowerCase().includes(normalizedQuery) ? 8 : 0) +
							latinTerms.reduce(
								(total, term) => total + (ability.name.toLocaleLowerCase().includes(term) ? 3 : 0),
								0,
							) +
							cjkTerms.reduce((total, term) => total + (ability.name.includes(term) ? 2 : 0), 0) +
							matchingCjk;
						const meta = ability.detail.meta ?? [];
						const docsUrl = meta.find((item) => item.key === "docs")?.value;
						const candidateRepository = meta.find((item) => item.key === "repository")?.value;
						const repositoryUrl =
							candidateRepository?.trim() !== ability.origin.repository.trim() ? candidateRepository : undefined;
						return {
							score,
							result: {
								type: ability.type,
								slug: ability.slug,
								name: ability.name,
								description: ability.description,
								author: ability.author,
								version: ability.version,
								license: ability.license,
								category: ability.category,
								tags: ability.tags,
								...(docsUrl ? { docsUrl } : {}),
								...(repositoryUrl ? { repositoryUrl } : {}),
								sourceId: ability.origin.sourceId ?? "",
								...(ability.reviewStatus ? { reviewStatus: ability.reviewStatus } : {}),
								...(ability.installable !== undefined ? { installable: ability.installable } : {}),
								metadataIncomplete: ability.detailDeferred || !docsUrl || !repositoryUrl,
							},
						};
					})
					.filter((item): item is NonNullable<typeof item> => item !== null)
					.sort((left, right) => right.score - left.score)
					.slice(0, Math.min(20, Math.max(1, limit ?? 8)))
					.map((item) => item.result);
				return {
					results,
					stale: catalog.snapshots.some((snapshot) => snapshot.stale),
					failedSourceCount: catalog.failedSourceIds.length,
				};
			},
		},
		general: createOfficialGeneralApi(assertOfficial, capabilitySessionId),
		agent: createOfficialAgentApi(assertOfficial, capabilitySessionId),
		downloads: createOfficialDownloadsApi(assertOfficial, capabilitySessionId),
		dialog: createOfficialDialogApi(assertOfficial),
		shell: createOfficialShellApi(assertOfficial),
		updater: createOfficialUpdaterApi(assertOfficial, capabilitySessionId),
		webhook: createOfficialWebhookApi(assertOfficial, capabilitySessionId),
		skills: createOfficialSkillsApi(assertOfficial, capabilitySessionId),
		shortcuts: createOfficialShortcutsApi(assertOfficial, capabilitySessionId),
		im: createOfficialImApi(assertOfficial, capabilitySessionId),
		mcp: createOfficialMcpApi(assertOfficial, capabilitySessionId),
		models: createOfficialModelsApi(assertOfficial, capabilitySessionId),
		projects: createOfficialProjectsApi(assertOfficial, capabilitySessionId),
		plugins: createOfficialPluginsApi(assertOfficial, capabilitySessionId),
		knowledge: createOfficialKnowledgeApi(assertOfficial, capabilitySessionId),
		batchTasks: createOfficialBatchTasksApi(assertOfficial, capabilitySessionId),
		scheduler: createOfficialSchedulerApi(assertOfficial, capabilitySessionId),
		appearance: createOfficialAppearanceApi(capabilitySessionId),
		sessions: createOfficialSessionsApi(capabilitySessionId),
		navigation: createOfficialNavigationApi(capabilitySessionId),
	};
}
