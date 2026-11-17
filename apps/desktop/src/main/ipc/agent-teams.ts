import { randomUUID } from "node:crypto";
import type { TeamSessionDocument, TeamSessionReference, TeamSessionSnapshot } from "@567agent/agent-team";
import {
	parseCreateAgentProfileInput,
	parseDeleteAgentProfileInput,
	parseDeleteTeamInput,
	parseUpdateAgentProfileInput,
	parseUpdateTeamSessionModelSettingsInput,
} from "@567agent/agent-team";
import type { SessionExecutionMode } from "@567agent/runtime-core";
import { dialog, type IpcMainInvokeEvent, ipcMain, type WebContents, webContents } from "electron";
import type {
	DesktopTeamConversationDisplay,
	DesktopTeamSessionSnapshot,
	DesktopTeamSessionStreamEvent,
} from "../../preload/api-types/team-conversation-display.js";
import { storeAgentAvatarFile } from "../agent-teams/agent-avatar-store.js";
import { agentTeamStore } from "../agent-teams/agent-team-store.js";
import {
	getExpertPresetSourceStatus,
	initPluginAgentPresetSync,
	onExpertPresetSourceChanged,
	refreshMarketplaceAgentPresets,
} from "../agent-teams/plugin-agent-preset-sync.js";
import {
	parseTeamMemberModelSelection,
	teamMemberModelPreferences,
} from "../agent-teams/team-member-model-preferences.js";
import { agentTeamSessionService } from "../agent-teams/team-session-service.js";
import { listTeamSidebarConversations } from "../conversations/team-sidebar-conversation-projection.js";
import { mainT } from "../i18n/index.js";
import { getAppLogger } from "../logger.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

const log = getAppLogger("agent-teams-ipc");

const CHANNELS = {
	LIST: "vetta:agent-teams:list",
	PRESET_STATUS: "vetta:agent-teams:preset-source-status",
	PRESET_REFRESH: "vetta:agent-teams:refresh-preset-source",
	BLUEPRINTS: "vetta:agent-teams:list-blueprints",
	CREATE_AGENT: "vetta:agent-teams:create-agent",
	UPDATE_AGENT: "vetta:agent-teams:update-agent",
	DELETE_AGENT: "vetta:agent-teams:delete-agent",
	PREVIEW_AGENT: "vetta:agent-teams:preview-agent-update",
	PREVIEW_AGENT_DELETE: "vetta:agent-teams:preview-agent-delete",
	CREATE_TEAM: "vetta:agent-teams:create-team",
	UPDATE_TEAM: "vetta:agent-teams:update-team",
	DELETE_TEAM: "vetta:agent-teams:delete-team",
	CREATE_SESSION: "vetta:agent-teams:create-session",
	CREATE_SESSION_RECORD: "vetta:agent-teams:create-session-record",
	LIST_SESSIONS: "vetta:agent-teams:list-sessions",
	LIST_SIDEBAR_CONVERSATIONS: "vetta:agent-teams:list-sidebar-conversations",
	RENAME_SESSION: "vetta:agent-teams:rename-session",
	DELETE_SESSION: "vetta:agent-teams:delete-session",
	UPDATE_MODEL_SETTINGS: "vetta:agent-teams:update-model-settings",
	LIST_MEMBER_MODELS: "vetta:agent-teams:list-member-models",
	SET_MEMBER_MODEL: "vetta:agent-teams:set-member-model",
	SET_EXECUTION_MODE: "vetta:agent-teams:set-execution-mode",
	GET_SESSION: "vetta:agent-teams:get-session",
	SEND_MESSAGE: "vetta:agent-teams:send-message",
	SUBSCRIBE: "vetta:agent-teams:subscribe",
	UNSUBSCRIBE: "vetta:agent-teams:unsubscribe",
	ABORT: "vetta:agent-teams:abort",
	UPLOAD_AVATAR: "vetta:agent-teams:upload-avatar",
} as const;

/** 主进程推给渲染进程的「配置已变」：插件装卸与热重载会在用户没动手的情况下改动配置。 */
const CHANGED_EVENT = "vetta:agent-teams:changed";

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
	return value;
}

function teamSessionReference(value: unknown): { readonly id: string; readonly coordinationSessionPath?: string } {
	if (typeof value === "string") return { id: requiredString(value, "sessionId") };
	if (
		typeof value !== "object" ||
		value === null ||
		Object.keys(value).some((key) => key !== "id" && key !== "coordinationSessionPath") ||
		!("id" in value) ||
		!("coordinationSessionPath" in value)
	) {
		throw new Error("Invalid Team session reference");
	}
	const reference = value as TeamSessionReference;
	return {
		id: requiredString(reference.id, "sessionId"),
		coordinationSessionPath: requiredString(reference.coordinationSessionPath, "coordinationSessionPath"),
	};
}

export interface AgentTeamsIpcDependencies {
	readonly listSidebarConversations?: typeof listTeamSidebarConversations;
	readonly memberModels?: Pick<typeof teamMemberModelPreferences, "list" | "set">;
	readonly store: Pick<
		typeof agentTeamStore,
		| "onPluginPresetsApplied"
		| "read"
		| "listBlueprints"
		| "createAgent"
		| "updateAgent"
		| "deleteAgent"
		| "previewAgentUpdate"
		| "previewAgentDelete"
		| "createTeam"
		| "updateTeam"
		| "deleteTeam"
	>;
	readonly sessions: Pick<
		typeof agentTeamSessionService,
		| "create"
		| "listSessions"
		| "updateModelSettings"
		| "setExecutionMode"
		| "renameSession"
		| "deleteSession"
		| "readArchiveSnapshot"
		| "send"
		| "snapshot"
		| "subscribe"
		| "abort"
	> &
		Partial<Pick<typeof agentTeamSessionService, "displayProjection" | "createRecord">>;
}

type TeamDisplayProjection = (
	session: TeamSessionDocument,
) => DesktopTeamConversationDisplay | Promise<DesktopTeamConversationDisplay>;

function teamSessionMutationReference(value: unknown): TeamSessionReference {
	const reference = teamSessionReference(value);
	if (!reference.coordinationSessionPath) throw new Error("coordinationSessionPath must be a non-empty string");
	return { id: reference.id, coordinationSessionPath: reference.coordinationSessionPath };
}

async function withDisplayProjection(
	snapshot: TeamSessionSnapshot,
	displayProjection?: TeamDisplayProjection,
): Promise<DesktopTeamSessionSnapshot> {
	return {
		...snapshot,
		display: displayProjection ? await displayProjection(snapshot.session) : { memberConversations: [] },
	};
}

async function enrichTeamEvent(
	event: Parameters<AgentTeamsIpcDependencies["sessions"]["subscribe"]>[1] extends (payload: infer P) => void
		? P
		: never,
	displayProjection?: TeamDisplayProjection,
): Promise<DesktopTeamSessionStreamEvent> {
	if (event.type === "session-snapshot" || event.type === "session-updated") {
		return { ...event, snapshot: await withDisplayProjection(event.snapshot, displayProjection) };
	}
	return event as DesktopTeamSessionStreamEvent;
}

export function registerAgentTeamsIpc(
	owner: WebContents,
	dependencies: AgentTeamsIpcDependencies = { store: agentTeamStore, sessions: agentTeamSessionService },
): () => void {
	const { store, sessions } = dependencies;
	const handle = (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
		ipcMain.handle(channel, (event, ...args: unknown[]) => {
			assertTrustedMainRenderer(event, owner);
			return listener(event, ...args);
		});
	};
	const retired = (): never => {
		throw new Error(mainT("agentTeamsRetired"));
	};
	const memberModels = dependencies.memberModels ?? teamMemberModelPreferences;
	// 必须先于任何一次读配置：回填要按当前可用的插件 blueprint 决定铺哪些档案。
	initPluginAgentPresetSync();
	// `displayProjection` is invoked later by IPC callbacks. Bind it once here so
	// the service keeps its runtime/repository context when passed as a callback.
	const displayProjection = sessions.displayProjection?.bind(sessions);
	const subscriptions = new Map<string, () => void>();
	// 插件重铺预设后必须推给渲染进程：那一份文档是它自己缓存的，没有这条广播，侧边栏要等到下次
	// 重启 App 才跟上新的智能体与团队。
	const unsubscribePresets = store.onPluginPresetsApplied(() => {
		for (const contents of webContents.getAllWebContents()) {
			if (contents.isDestroyed()) continue;
			try {
				contents.send(CHANGED_EVENT);
			} catch {
				// ignore gone frames
			}
		}
	});
	handle(CHANNELS.LIST, () => store.read());
	handle(CHANNELS.PRESET_STATUS, () => getExpertPresetSourceStatus());
	handle(CHANNELS.PRESET_REFRESH, () => refreshMarketplaceAgentPresets());
	const unsubscribePresetStatus = onExpertPresetSourceChanged(() => {
		for (const contents of webContents.getAllWebContents()) {
			if (contents.isDestroyed()) continue;
			try {
				contents.send("vetta:agent-teams:preset-source-changed");
			} catch {
				/* frame closed */
			}
		}
	});
	// 让用户挑一张本地图片当头像：主进程复制进头像目录，只把渲染进程能加载的 URL 交回去。
	handle(CHANNELS.UPLOAD_AVATAR, async () => {
		const result = await dialog.showOpenDialog({
			properties: ["openFile"],
			filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
		});
		const source = result.canceled ? undefined : result.filePaths[0];
		if (!source) return undefined;
		const stored = await storeAgentAvatarFile(source);
		return stored.url;
	});
	handle(CHANNELS.BLUEPRINTS, () => store.listBlueprints());
	handle(CHANNELS.CREATE_AGENT, (_event, input: unknown) => store.createAgent(parseCreateAgentProfileInput(input)));
	handle(CHANNELS.UPDATE_AGENT, (_event, agentProfileId: unknown, input: unknown) =>
		store.updateAgent(requiredString(agentProfileId, "agentProfileId"), parseUpdateAgentProfileInput(input)),
	);
	handle(CHANNELS.DELETE_AGENT, (_event, agentProfileId: unknown, input: unknown) =>
		store.deleteAgent(requiredString(agentProfileId, "agentProfileId"), parseDeleteAgentProfileInput(input)),
	);
	handle(CHANNELS.PREVIEW_AGENT, (_event, agentProfileId: unknown) =>
		store.previewAgentUpdate(requiredString(agentProfileId, "agentProfileId")),
	);
	handle(CHANNELS.PREVIEW_AGENT_DELETE, (_event, agentProfileId: unknown) =>
		store.previewAgentDelete(requiredString(agentProfileId, "agentProfileId")),
	);
	handle(CHANNELS.CREATE_TEAM, retired);
	handle(CHANNELS.UPDATE_TEAM, retired);
	handle(CHANNELS.DELETE_TEAM, (_event, teamId: unknown, input: unknown) =>
		store.deleteTeam(requiredString(teamId, "teamId"), parseDeleteTeamInput(input)),
	);
	handle(CHANNELS.LIST_MEMBER_MODELS, async (_event, teamId: unknown) => {
		const id = requiredString(teamId, "teamId");
		const team = (await store.read()).teams.find((candidate) => candidate.id === id);
		if (!team) throw new Error("Team not found");
		return memberModels.list(team);
	});
	handle(CHANNELS.SET_MEMBER_MODEL, async (_event, teamId: unknown, memberId: unknown, value: unknown) => {
		const id = requiredString(teamId, "teamId");
		const team = (await store.read()).teams.find((candidate) => candidate.id === id);
		if (!team) throw new Error("Team not found");
		return memberModels.set(team, requiredString(memberId, "memberId"), parseTeamMemberModelSelection(value));
	});
	handle(CHANNELS.CREATE_SESSION, retired);
	handle(CHANNELS.CREATE_SESSION_RECORD, retired);
	handle(CHANNELS.LIST_SESSIONS, (_event, teamId: unknown) => sessions.listSessions(requiredString(teamId, "teamId")));
	handle(CHANNELS.LIST_SIDEBAR_CONVERSATIONS, () =>
		(dependencies.listSidebarConversations ?? listTeamSidebarConversations)(),
	);
	handle(CHANNELS.RENAME_SESSION, async (_event, reference: unknown, name: unknown) => {
		if (typeof name !== "string" || name.trim().length === 0) throw new Error("name must be a non-empty string");
		return await withDisplayProjection(
			sessions.snapshot(await sessions.renameSession(teamSessionMutationReference(reference), name)),
			displayProjection,
		);
	});
	handle(CHANNELS.DELETE_SESSION, async (_event, reference: unknown) => {
		return await sessions.deleteSession(teamSessionMutationReference(reference));
	});
	handle(
		CHANNELS.UPDATE_MODEL_SETTINGS,
		async (_event, id: unknown, input: unknown) =>
			await withDisplayProjection(
				sessions.snapshot(
					await sessions.updateModelSettings(
						requiredString(id, "sessionId"),
						parseUpdateTeamSessionModelSettingsInput(input),
					),
				),
				displayProjection,
			),
	);
	handle(CHANNELS.SET_EXECUTION_MODE, async (_event, id: unknown, mode: unknown) => {
		if (mode !== "sandbox" && mode !== "full-access") throw new Error("Invalid executionMode");
		return await withDisplayProjection(
			sessions.snapshot(
				await sessions.setExecutionMode(requiredString(id, "sessionId"), mode as SessionExecutionMode),
			),
			displayProjection,
		);
	});
	handle(CHANNELS.GET_SESSION, async (_event, value: unknown) => {
		const reference = teamSessionReference(value);
		const startedAt = Date.now();
		log.info("team get-session started", {
			teamSessionId: reference.id,
			hasCoordinationSessionPath: Boolean(reference.coordinationSessionPath),
		});
		try {
			const snapshot = await sessions.readArchiveSnapshot(reference.id, reference.coordinationSessionPath);
			const projected = await withDisplayProjection(snapshot, displayProjection);
			log.info("team get-session completed", {
				teamSessionId: reference.id,
				elapsedMs: Date.now() - startedAt,
			});
			return projected;
		} catch (error) {
			log.error("team get-session failed", {
				teamSessionId: reference.id,
				elapsedMs: Date.now() - startedAt,
				error: error instanceof Error ? error.message : String(error),
			});
			throw error;
		}
	});
	handle(CHANNELS.SEND_MESSAGE, retired);
	handle(CHANNELS.ABORT, (_event, id: unknown) => sessions.abort(requiredString(id, "sessionId")));
	handle(CHANNELS.SUBSCRIBE, async (event, id: unknown) => {
		const sessionId = requiredString(id, "sessionId");
		const subscriptionId = `${sessionId}:${randomUUID()}`;
		log.info("team stream subscription started", { teamSessionId: sessionId, subscriptionId });
		let sendQueue = Promise.resolve();
		const subscription = sessions.subscribe(sessionId, (payload) => {
			sendQueue = sendQueue
				.then(async () => {
					if (event.sender.isDestroyed()) return;
					event.sender.send(
						"vetta:agent-teams:stream-event",
						subscriptionId,
						await enrichTeamEvent(payload, displayProjection),
					);
				})
				.catch((error: unknown) => {
					log.error("team stream event delivery failed", {
						teamSessionId: sessionId,
						subscriptionId,
						eventType: payload.type,
						error: error instanceof Error ? error.message : String(error),
					});
				});
		});
		const cleanup = () => {
			event.sender.removeListener("destroyed", cleanup);
			subscription.unsubscribe();
			subscriptions.delete(subscriptionId);
			log.info("team stream subscription cleaned up", { teamSessionId: sessionId, subscriptionId });
		};
		event.sender.once("destroyed", cleanup);
		subscriptions.set(subscriptionId, cleanup);
		const response = {
			subscriptionId,
			...(subscription.snapshot ? { initial: await enrichTeamEvent(subscription.snapshot, displayProjection) } : {}),
		};
		log.info("team stream subscription ready", {
			teamSessionId: sessionId,
			subscriptionId,
			hasInitialSnapshot: Boolean(subscription.snapshot),
		});
		return response;
	});
	handle(CHANNELS.UNSUBSCRIBE, (_event, subscriptionId: unknown) => {
		const key = requiredString(subscriptionId, "subscriptionId");
		subscriptions.get(key)?.();
	});
	return () => {
		unsubscribePresets();
		unsubscribePresetStatus();
		for (const unsubscribe of subscriptions.values()) unsubscribe();
		subscriptions.clear();
		for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
	};
}
