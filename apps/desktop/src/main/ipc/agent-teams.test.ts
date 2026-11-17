import { createAgentTeamFixture, createEmptyAgentTeamDocument } from "@567agent/agent-team";
import type { WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AgentTeamsIpcDependencies, registerAgentTeamsIpc } from "./agent-teams.js";

const ipc = vi.hoisted(() => ({
	handlers: new Map<string, (...args: unknown[]) => unknown>(),
	removed: [] as string[],
	sent: [] as string[],
}));

vi.mock("electron", () => ({
	ipcMain: {
		handle: (channel: string, handler: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, handler),
		removeHandler: (channel: string) => ipc.removed.push(channel),
	},
	webContents: {
		getAllWebContents: () => [
			{ isDestroyed: () => false, send: (channel: string) => ipc.sent.push(channel) },
			// 已经关掉的窗口不该收到广播，也不该让这一轮广播抛出来。
			{
				isDestroyed: () => true,
				send: () => {
					throw new Error("sent to a destroyed frame");
				},
			},
		],
	},
}));

vi.mock("../agent-teams/agent-team-store.js", () => ({ agentTeamStore: {} }));
vi.mock("../agent-teams/team-session-service.js", () => ({ agentTeamSessionService: {} }));
// 预设同步会拉起插件目录（进而拉起 electron.app）；这里只验 IPC 布线，把它挡在外面。
vi.mock("../agent-teams/plugin-agent-preset-sync.js", () => ({
	initPluginAgentPresetSync: vi.fn(),
	getExpertPresetSourceStatus: () => ({ phase: "idle", syncedAt: null, count: 0, hasCache: false }),
	onExpertPresetSourceChanged: () => () => {},
	refreshMarketplaceAgentPresets: vi.fn(async () => {}),
}));
vi.mock("../logger.js", () => ({
	getAppLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const sender = {
	mainFrame: {},
	isDestroyed: () => false,
	send: vi.fn(),
	once: vi.fn(),
	removeListener: vi.fn(),
};
const owner = sender as unknown as WebContents;
const event = { sender, senderFrame: sender.mainFrame };

function dependencies(): AgentTeamsIpcDependencies {
	return {
		memberModels: {
			list: vi.fn(async () => ({})),
			set: vi.fn(async () => ({})),
		},
		store: {
			read: vi.fn(async () => createEmptyAgentTeamDocument()),
			onPluginPresetsApplied: vi.fn(() => () => {}),
			listBlueprints: vi.fn(async () => []),
			createAgent: vi.fn(async (input) => ({ ...input, id: "agent" })),
			updateAgent: vi.fn(),
			deleteAgent: vi.fn(),
			previewAgentUpdate: vi.fn(),
			previewAgentDelete: vi.fn(),
			createTeam: vi.fn(),
			updateTeam: vi.fn(),
			deleteTeam: vi.fn(),
		},
		sessions: {
			create: vi.fn(),
			listSessions: vi.fn(async () => []),
			renameSession: vi.fn(),
			deleteSession: vi.fn(),
			readArchiveSnapshot: vi.fn(),
			send: vi.fn(),
			updateModelSettings: vi.fn(),
			setExecutionMode: vi.fn(),
			snapshot: vi.fn((session) => ({ session, conversationRevision: 0, messages: [], activities: [] })),
			subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
			abort: vi.fn(),
		},
	};
}

describe("Agent Team IPC contract", () => {
	beforeEach(() => {
		ipc.handlers.clear();
		ipc.removed.length = 0;
		ipc.sent.length = 0;
		sender.send.mockClear();
		sender.once.mockClear();
		sender.removeListener.mockClear();
	});

	it("tells every live renderer when the plugin presets are reapplied", () => {
		const deps = dependencies();
		registerAgentTeamsIpc(owner, deps);
		const notify = vi.mocked(deps.store.onPluginPresetsApplied).mock.calls[0]?.[0];
		if (!notify) throw new Error("the store was not subscribed");

		// 插件热重载不经过渲染进程，没有这条广播，侧边栏要等到重启 App 才跟上。
		notify(createEmptyAgentTeamDocument());

		expect(ipc.sent).toEqual(["vetta:agent-teams:changed"]);
	});

	it("validates renderer input before invoking the domain service", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(owner, deps);
		const createAgent = ipc.handlers.get("vetta:agent-teams:create-agent");
		if (!createAgent) throw new Error("create-agent handler was not registered");

		expect(() => createAgent(event, { name: "Missing required fields" })).toThrow(
			"Invalid create agent profile input",
		);
		expect(deps.store.createAgent).not.toHaveBeenCalled();

		await createAgent(event, {
			name: "Builder",
			mentionHandle: "builder",
			blueprintId: "builder",
			abilities: { skills: [], mcpServers: [], plugins: [] },
		});
		expect(deps.store.createAgent).toHaveBeenCalledOnce();
	});

	it("rejects retired sends and removes every registered handler", () => {
		const deps = dependencies();
		const teardown = registerAgentTeamsIpc(owner, deps);
		const sendMessage = ipc.handlers.get("vetta:agent-teams:send-message")!;
		expect(() =>
			sendMessage(event, "session", { requestId: "request", text: "Hello", targetMemberIds: [] }),
		).toThrow();
		expect(deps.sessions.send).not.toHaveBeenCalled();
		teardown();
		expect(ipc.removed).toHaveLength(ipc.handlers.size);
	});

	it("rejects a foreign renderer before touching expert data", () => {
		const deps = dependencies();
		registerAgentTeamsIpc(owner, deps);
		const createAgent = ipc.handlers.get("vetta:agent-teams:create-agent")!;
		expect(() => createAgent({ ...event, sender: { isDestroyed: () => false } }, { name: "Foreign" })).toThrow(
			"Untrusted renderer IPC caller",
		);
		expect(deps.store.createAgent).not.toHaveBeenCalled();
	});

	it("passes an ordinary Conversation bookmark when reopening a Team session", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(owner, deps);
		const getSession = ipc.handlers.get("vetta:agent-teams:get-session");
		if (!getSession) throw new Error("get-session handler was not registered");

		await getSession(event, { id: "session", coordinationSessionPath: "C:/runtime/session.jsonl" });
		expect(deps.sessions.readArchiveSnapshot).toHaveBeenCalledWith("session", "C:/runtime/session.jsonl");

		await expect(
			getSession(event, { id: "session", coordinationSessionPath: "C:/runtime/session.jsonl", privateState: true }),
		).rejects.toThrow("Invalid Team session reference");
	});

	it("keeps the Team service context when projecting a reopened session", async () => {
		const base = dependencies();
		const displayProjection = vi.fn(async function (this: { getRuntime: () => unknown }) {
			this.getRuntime();
			return { memberConversations: [] };
		});
		const sessionServices = {
			...base.sessions,
			readArchiveSnapshot: vi.fn(async () => ({
				session: {} as never,
				conversationRevision: 0,
				messages: [],
				activities: [],
			})),
			getRuntime: vi.fn(),
			displayProjection: displayProjection as AgentTeamsIpcDependencies["sessions"]["displayProjection"],
		};
		const deps: AgentTeamsIpcDependencies = {
			...base,
			sessions: sessionServices as AgentTeamsIpcDependencies["sessions"],
		};
		registerAgentTeamsIpc(owner, deps);
		const getSession = ipc.handlers.get("vetta:agent-teams:get-session");
		if (!getSession) throw new Error("get-session handler was not registered");

		await expect(getSession(event, "session")).resolves.toMatchObject({ display: { memberConversations: [] } });
		expect(displayProjection).toHaveBeenCalledOnce();
	});

	it("projects the archived snapshot for the history viewer", async () => {
		const base = dependencies();
		const displayProjection = vi.fn(async () => ({ memberConversations: [] }));
		const sessionServices = {
			...base.sessions,
			readArchiveSnapshot: vi.fn(async () => ({
				session: {} as never,
				conversationRevision: 1,
				messages: [],
				activities: [],
			})),
			displayProjection: displayProjection,
		};
		registerAgentTeamsIpc(owner, { ...base, sessions: sessionServices as AgentTeamsIpcDependencies["sessions"] });
		const getSession = ipc.handlers.get("vetta:agent-teams:get-session");
		if (!getSession) throw new Error("get-session handler was not registered");

		await expect(
			getSession(event, { id: "session", coordinationSessionPath: "C:/runtime/session.jsonl" }),
		).resolves.toMatchObject({
			display: { memberConversations: [] },
		});
		expect(displayProjection).toHaveBeenCalledOnce();
	});

	it("rejects new Team sessions while retaining the history catalog", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(owner, deps);
		const createSession = ipc.handlers.get("vetta:agent-teams:create-session")!;
		expect(() => createSession(event, "team")).toThrow();
		await ipc.handlers.get("vetta:agent-teams:list-sessions")!(event, "team");
		expect(deps.sessions.create).not.toHaveBeenCalled();
		expect(deps.sessions.listSessions).toHaveBeenCalledWith("team");
	});

	it("publishes the product-level sidebar projection through one IPC call", async () => {
		const deps = dependencies();
		const projected = [
			{
				kind: "agent-team" as const,
				teamId: "team-1",
				teamSessionId: "team-session-1",
				coordinationSessionPath: "C:/sessions/team.jsonl",
				cwd: "C:/sessions",
				memberAvatarUrls: ["./agent-team-avatars/master.webp"],
				sessionTitle: "Build",
				createdAt: 1,
				updatedAt: 2,
				placement: { kind: "default" as const },
			},
		];
		const listSidebarConversations = vi.fn(async () => projected);
		registerAgentTeamsIpc(owner, { ...deps, listSidebarConversations });
		const listSidebar = ipc.handlers.get("vetta:agent-teams:list-sidebar-conversations");
		if (!listSidebar) throw new Error("list-sidebar-conversations handler was not registered");

		await expect(listSidebar(event)).resolves.toEqual(projected);
		expect(listSidebarConversations).toHaveBeenCalledOnce();
	});

	it("routes Team session rename and delete through validated references", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(owner, deps);
		const reference = { id: "session-1", coordinationSessionPath: "C:/sessions/session-1.jsonl" };
		const renameSession = ipc.handlers.get("vetta:agent-teams:rename-session");
		const deleteSession = ipc.handlers.get("vetta:agent-teams:delete-session");
		if (!renameSession || !deleteSession) throw new Error("Team session mutation handlers were not registered");

		await renameSession(event, reference, "Renamed");
		await deleteSession(event, reference);
		expect(deps.sessions.renameSession).toHaveBeenCalledWith(reference, "Renamed");
		expect(deps.sessions.deleteSession).toHaveBeenCalledWith(reference);
		await expect(renameSession(event, reference, " ")).rejects.toThrow("name must be a non-empty string");
	});

	it("rejects lightweight Team creation without allocating a record", () => {
		const deps = dependencies();
		deps.sessions.createRecord = vi.fn();
		registerAgentTeamsIpc(owner, deps);
		expect(() => ipc.handlers.get("vetta:agent-teams:create-session-record")!(event, "team")).toThrow();
		expect(deps.sessions.createRecord).not.toHaveBeenCalled();
		expect(deps.sessions.create).not.toHaveBeenCalled();
	});

	it("validates and forwards Team-session model settings", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(owner, deps);
		const updateModelSettings = ipc.handlers.get("vetta:agent-teams:update-model-settings");
		if (!updateModelSettings) throw new Error("update-model-settings handler was not registered");

		await updateModelSettings(event, "session", { modelKey: "openai/gpt-5", reasoning: "high" });
		expect(deps.sessions.updateModelSettings).toHaveBeenCalledWith("session", {
			modelKey: "openai/gpt-5",
			reasoning: "high",
		});

		await expect(updateModelSettings(event, "session", { reasoning: "high" })).rejects.toThrow(
			"Invalid Team session model settings input",
		);
	});

	it("validates and forwards member model preferences for an existing team", async () => {
		const deps = dependencies();
		const document = createAgentTeamFixture();
		const team = document.teams[0]!;
		const memberId = team.members[0]!.id;
		deps.store.read = vi.fn(async () => document);
		registerAgentTeamsIpc(owner, deps);
		const list = ipc.handlers.get("vetta:agent-teams:list-member-models");
		const set = ipc.handlers.get("vetta:agent-teams:set-member-model");
		if (!list || !set) throw new Error("member model handlers were not registered");
		await list(event, team.id);
		expect(deps.memberModels?.list).toHaveBeenCalledWith(team);
		await set(event, team.id, memberId, { modelKey: "provider/model", reasoning: "high" });
		expect(deps.memberModels?.set).toHaveBeenCalledWith(team, memberId, {
			modelKey: "provider/model",
			reasoning: "high",
		});
		await set(event, team.id, memberId, null);
		expect(deps.memberModels?.set).toHaveBeenLastCalledWith(team, memberId, null);
		await expect(set(event, team.id, memberId, { modelKey: "invalid" })).rejects.toThrow();
		await expect(set(event, "missing", memberId, null)).rejects.toThrow("Team not found");
	});

	it("validates and forwards the Team-scoped execution mode", async () => {
		const deps = dependencies();
		registerAgentTeamsIpc(owner, deps);
		const setExecutionMode = ipc.handlers.get("vetta:agent-teams:set-execution-mode");
		if (!setExecutionMode) throw new Error("set-execution-mode handler was not registered");

		await setExecutionMode(event, "session", "sandbox");
		expect(deps.sessions.setExecutionMode).toHaveBeenCalledWith("session", "sandbox");
		await expect(setExecutionMode(event, "session", "invalid")).rejects.toThrow("Invalid executionMode");
	});

	it("bridges stream subscriptions and abort requests", async () => {
		const deps = dependencies();
		const streamHandler = vi.fn();
		const unsubscribe = vi.fn();
		deps.sessions.subscribe = vi.fn((_id, handler) => {
			streamHandler.mockImplementation(handler);
			return {
				unsubscribe,
				snapshot: {
					type: "session-snapshot" as const,
					teamSessionId: "session",
					snapshot: {
						session: {
							schemaVersion: 1 as const,
							revision: 0,
							id: "session",
							teamId: "team",
							name: "Team",
							cwd: "C:/workspace",
							leaderMemberId: "leader",
							memberHandles: { leader: "vetta" },
							createdAt: 1,
							updatedAt: 1,
							events: [],
							memberRuntime: {},
						},
						conversationRevision: 0,
						messages: [],
						activities: [],
					},
					activeMessageEvents: [],
				},
			};
		});
		registerAgentTeamsIpc(owner, deps);

		const subscribe = ipc.handlers.get("vetta:agent-teams:subscribe");
		if (!subscribe) throw new Error("subscribe handler was not registered");
		const result = (await subscribe(event, "session")) as {
			subscriptionId: string;
			initial: { type: string };
		};
		expect(result.initial.type).toBe("session-snapshot");
		streamHandler({
			type: "conversation.agent-message-discard",
			conversationId: "session",
			messageId: "message",
			turnId: "request",
			author: { kind: "agent", id: "m" },
			sequence: 1,
			reason: "completed",
			timestamp: 1,
		});
		await new Promise<void>((resolve) => queueMicrotask(resolve));
		expect(sender.send).toHaveBeenCalledWith(
			"vetta:agent-teams:stream-event",
			result.subscriptionId,
			expect.objectContaining({ type: "conversation.agent-message-discard", reason: "completed" }),
		);
		const onDestroyed = sender.once.mock.calls[0]?.[1] as (() => void) | undefined;
		onDestroyed?.();
		expect(unsubscribe).toHaveBeenCalledOnce();

		const abort = ipc.handlers.get("vetta:agent-teams:abort");
		if (!abort) throw new Error("abort handler was not registered");
		await abort(event, "session");
		expect(deps.sessions.abort).toHaveBeenCalledWith("session");
	});
});
