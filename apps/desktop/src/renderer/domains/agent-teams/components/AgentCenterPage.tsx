import { teamDisplayName } from "@shared/agent-teams/agent-team-presentation";
import { useAgentAvatarResolver } from "@shared/agent-teams/agent-avatar";
import { notifyAgentTeamConfigurationChanged } from "@shared/agent-teams/team-session-events";
import { confirmDialogAtom, pageHeaderTitleHiddenAtom, projectsAtom, expertPreferencesAtom } from "@shared/store/atoms";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ExpertCatalogTab } from "@vetta-org/theme-ui/shared";
import { Button } from "@vetta-org/ui";
import { useExpertPresetSource } from "../hooks/useExpertPresetSource";
import { useAgentCenterModel } from "../hooks/useAgentCenterModel";
import type { AgentProfile } from "@567agent/agent-team";
import { copyExpertDraft, expertWorkflow } from "../lib/expert-draft";
import { AgentCenterView } from "./AgentCenterView";
import { AgentProfileSheet } from "./AgentProfileSheet";
import { EXPERT_CATEGORIES, expertCategory } from "../lib/expert-category";

export function AgentCenterPage(): JSX.Element {
	const { t, i18n } = useTranslation("agent-teams");
	const confirm = useSetAtom(confirmDialogAtom);
	const setHeaderTitleHidden = useSetAtom(pageHeaderTitleHiddenAtom);
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as {
		agent?: string;
		copy?: string;
		tab?: ExpertCatalogTab;
		cwd?: string;
	};
	const tab = search.tab ?? "experts";
	const model = useAgentCenterModel({
		defaultName: t("library.defaultAgentName"),
		defaultDescription: t("library.defaultAgentDescription"),
	});
	const presetSource = useExpertPresetSource(model.reload);
	const projects = useAtomValue(projectsAtom);
	const [preferences, updatePreferences] = useAtom(expertPreferencesAtom);
	const resolveAvatar = useAgentAvatarResolver();
	useEffect(() => {
		setHeaderTitleHidden(true);
		return () => setHeaderTitleHidden(false);
	}, [setHeaderTitleHidden]);
	const openAgent = useCallback(
		(id: string) =>
			void navigate({ to: "/agents", search: { tab, agent: id, ...(search.cwd ? { cwd: search.cwd } : {}) } }),
		[navigate, search.cwd, tab],
	);
	const closeSheets = useCallback(
		() => void navigate({ to: "/agents", search: { tab, ...(search.cwd ? { cwd: search.cwd } : {}) } }),
		[navigate, search.cwd, tab],
	);
	const useExpert = useCallback(
		(id: string) => {
			updatePreferences({ kind: "use", id });
			void navigate({
				to: "/new-session",
				search: { target: `agent:${id}`, ...(search.cwd ? { cwd: search.cwd } : {}) },
			});
		},
		[navigate, search.cwd, updatePreferences],
	);
	const copyExpert = useCallback(
		(id: string) =>
			void navigate({
				to: "/agents",
				search: { tab: "experts", copy: id, ...(search.cwd ? { cwd: search.cwd } : {}) },
			}),
		[navigate, search.cwd],
	);
	const sheetAgent = search.agent && search.agent !== "new" ? model.findAgent(search.agent) : undefined;
	const source = search.copy ? model.findAgent(search.copy) : undefined;

	async function requestDeleteAgent(): Promise<void> {
		if (!sheetAgent) return;
		const impact = await model.actions.previewAgentDelete(sheetAgent.id);
		if (!impact) return;
		const impactLabels = impact.teams.map((team) => {
			const definition = model.document?.teams.find((candidate) => candidate.id === team.teamId);
			const name = definition ? teamDisplayName(definition, t) : team.teamName;
			if (team.deletesTeam) return t("library.deleteImpactDeleteTeam", { team: name });
			if (team.nextLeaderName) return t("library.deleteImpactTransfer", { team: name, name: team.nextLeaderName });
			return t("library.deleteImpactTeam", { team: name });
		});
		confirm({
			title: impact.teams.length ? t("library.deleteCascadeTitle") : t("library.deleteTitle"),
			message: impact.teams.length
				? t("library.deleteCascadeMessage", { name: sheetAgent.name, teams: impactLabels.join("、") })
				: t("library.deleteMessage", { name: sheetAgent.name }),
			confirmLabel: t("library.delete"),
			variant: "danger",
			onConfirm: () => {
				void model.actions.deleteAgent(sheetAgent, impact).then((deleted) => {
					if (deleted) {
						closeSheets();
						notifyAgentTeamConfigurationChanged();
					}
				});
			},
		});
	}
	if (model.loading)
		return (
			<div role="status" className="p-8 text-sm text-muted-foreground">
				{t("loading")}
			</div>
		);
	if (model.error && !model.document)
		return (
			<div role="alert" className="p-8 text-sm text-destructive">
				{t("error.load", { error: model.error })}
			</div>
		);
	return (
		<>
			{model.error && (
				<p role="alert" className="px-8 py-2 text-sm text-destructive">
					{model.error}
				</p>
			)}
			<AgentCenterView
				tab={tab}
				sourceStatus={{
					name: presetSource.status.sourceName ?? t("experts.source.name"),
					message: t(
						`experts.source.${presetSource.status.phase === "error" ? (presetSource.status.hasCache ? "cachedError" : "error") : presetSource.status.phase}`,
						{ count: presetSource.status.count },
					),
					updatedAt: presetSource.status.syncedAt
						? t("experts.source.updatedAt", {
								time: new Date(presetSource.status.syncedAt).toLocaleString(i18n.language),
							})
						: undefined,
					refreshing: presetSource.refreshing,
					refreshLabel: presetSource.refreshing ? t("experts.source.syncing") : t("experts.source.refresh"),
				}}
				onRefreshSource={() => void presetSource.refresh()}
				title={t("experts.title")}
				subtitle={t("experts.subtitle")}
				tabs={[
					{ id: "experts", label: t("experts.tabs.experts") },
					{ id: "collaboration", label: t("experts.tabs.collaboration") },
				]}
				experts={model.agents.map((agent) => ({
					id: agent.id,
					favorite: preferences.favorites.includes(agent.id),
					recentIndex: preferences.recent.includes(agent.id) ? preferences.recent.indexOf(agent.id) : undefined,
					unavailableReason:
						agent.source && !model.blueprints.some((item) => item.id === agent.blueprintId)
							? t("experts.unavailable")
							: undefined,
					name: agent.name,
					description: agent.description,
					avatar: resolveAvatar(agent),
					category: expertCategory(agent),
					categoryLabel: t(`experts.categories.${expertCategory(agent)}`),
					sourceLabel: agent.source ? t("experts.provided") : t("experts.custom"),
					abilityLabel:
						agent.abilities.selectionMode === "all"
							? t("experts.allAbilities")
							: t("experts.selectedAbilities", {
									count:
										agent.abilities.skills.length + agent.abilities.mcpServers.length + agent.abilities.plugins.length,
								}),
					workflow: expertWorkflow(
						agent.systemPrompt ??
							model.blueprints.find((blueprint) => blueprint.id === agent.blueprintId)?.systemPrompt ??
							"",
						i18n.language,
					),
				}))}
				projects={projects
					.filter((project) => project.type === "normal" && !project.isDefault)
					.map((project) => ({
						cwd: project.cwd,
						name: project.name ?? project.cwd.split(/[\\/]/).pop() ?? project.cwd,
						sessionLabel: t("experts.sessionCount", { count: project.sessionCount }),
					}))}
				categories={EXPERT_CATEGORIES.map((id) => ({ id, label: t(`experts.categories.${id}`) }))}
				preferences={{
					all: t("experts.preferences.all"),
					favorites: t("experts.preferences.favorites"),
					recent: t("experts.preferences.recent"),
					favorite: t("experts.preferences.favorite"),
					unfavorite: t("experts.preferences.unfavorite"),
					onToggleFavorite: (id) => updatePreferences({ kind: "favorite", id }),
				}}
				labels={{
					create: t("experts.create"),
					use: t("experts.use"),
					copy: t("experts.copy"),
					details: t("experts.details"),
					expertsEmpty: t("library.empty"),
					collaborationHint: t("experts.collaborationHint"),
					projectsEmpty: t("experts.projectsEmpty"),
					newProject: t("experts.newProject"),
					openProject: t("experts.openProject"),
					expertSearch: t("experts.search"),
					projectSearch: t("experts.projectSearch"),
					category: t("experts.category"),
					allCategories: t("experts.allCategories"),
					noMatches: t("experts.noMatches"),
					clearFilters: t("experts.clearFilters"),
					pagination: {
						previous: t("experts.pagination.previous"),
						next: t("experts.pagination.next"),
						summary: (page, pages, total) => t("experts.pagination.summary", { page, pages, total }),
					},
				}}
				onTabChange={(next) =>
					void navigate({ to: "/agents", search: { tab: next, ...(search.cwd ? { cwd: search.cwd } : {}) } })
				}
				onCreate={() => openAgent("new")}
				onUse={useExpert}
				onCopy={copyExpert}
				onDetails={openAgent}
				onProject={(cwd) => void navigate({ to: "/project/$cwd", params: { cwd: encodeURIComponent(cwd) } })}
				onNewProject={() => void navigate({ to: "/new-session" })}
			/>
			{search.agent && (
				<AgentProfileSheet
					key={search.agent}
					open
					mode={search.agent === "new" ? "create" : "edit"}
					agent={sheetAgent}
					blueprints={model.blueprints}
					plugins={model.plugins}
					capabilities={model.capabilities}
					onClose={closeSheets}
					onSaved={notifyAgentTeamConfigurationChanged}
					onPreview={model.actions.previewAgent}
					onSave={model.actions.saveAgent}
					onCreate={model.actions.createAgentFromDraft}
					onUse={useExpert}
					onCopy={copyExpert}
					{...(sheetAgent?.source || !sheetAgent ? {} : { onDelete: () => void requestDeleteAgent() })}
				/>
			)}
			{search.copy && (
				<CopyExpertSheet key={search.copy} source={source} model={model} onClose={closeSheets} onUse={useExpert} />
			)}
		</>
	);
}

/** Freeze the copy when opened; provider refreshes must not replace a user's draft. */
function CopyExpertSheet({
	source,
	model,
	onClose,
	onUse,
}: {
	readonly source?: AgentProfile;
	readonly model: ReturnType<typeof useAgentCenterModel>;
	readonly onClose: () => void;
	readonly onUse: (id: string) => void;
}): JSX.Element {
	const { t } = useTranslation(["agent-teams", "common"]);
	const sourceBlueprint = source ? model.blueprints.find((item) => item.id === source.blueprintId) : undefined;
	const canCopy = source && (sourceBlueprint || source.systemPrompt !== undefined);
	const [draft, setDraft] = useState(() =>
		canCopy
			? copyExpertDraft(
					source,
					model.blueprints.find((blueprint) => blueprint.id === source.blueprintId),
					model.capabilities,
					t("experts.copyName", { name: source.name }),
				)
			: undefined,
	);
	useEffect(() => {
		if (!draft && canCopy)
			setDraft(
				copyExpertDraft(
					source,
					model.blueprints.find((blueprint) => blueprint.id === source.blueprintId),
					model.capabilities,
					t("experts.copyName", { name: source.name }),
				),
			);
	}, [draft, source, canCopy, model.blueprints, model.capabilities, t]);
	if (!draft)
		return (
			<div className="flex items-center gap-3 p-5">
				<p role="alert" className="text-sm text-destructive">
					{t("experts.sourceMissing")}
				</p>
				<Button variant="outline" onClick={onClose}>
					{t("common:actions.close")}
				</Button>
			</div>
		);
	return (
		<AgentProfileSheet
			open
			mode="create"
			agent={draft}
			blueprints={model.blueprints}
			plugins={model.plugins}
			capabilities={model.capabilities}
			onClose={onClose}
			onSaved={notifyAgentTeamConfigurationChanged}
			onPreview={model.actions.previewAgent}
			onSave={model.actions.saveAgent}
			onCreate={model.actions.createAgentFromDraft}
			onUse={onUse}
		/>
	);
}
