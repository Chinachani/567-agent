import { getDefaultStore, useAtomValue } from "jotai";
import { SessionTaskProgress } from "../../src/renderer/domains/conversation/components/SessionTaskProgress";
import { ConversationDeliveries } from "../../src/renderer/domains/activity-panel/components/ConversationDeliveries";
import { ActivityPanelContextProvider } from "../../src/renderer/domains/activity-panel/registry/context";
import { ConfirmDialog } from "../../src/renderer/shared/components/ui/confirm-dialog";
import { activeSessionAtom, activeSessionStreamingAtom, chatMessagesAtom, pendingQuestionsAtom, confirmDialogAtom } from "../../src/renderer/shared/store/atoms";
import { createRoot } from "react-dom/client";
import { useState, useRef } from "react";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { AppFrame, MainContentFrame } from "@vetta-org/theme-ui/layout";
import { SidebarPanel, SidebarTopBar, SidebarNavigation } from "@vetta-org/theme-ui/sidebar";
import { AutomationPageView, TaskListView } from "@vetta-org/theme-ui/scheduler";
import { BatchTasksPageView } from "@vetta-org/theme-ui/batch-tasks";
import { SettingsPageShellView, SettingSection, SettingRow } from "@vetta-org/theme-ui/settings";
import { Message, MessageLayout, MessageVisual, ToolCall, NewSessionPageLayoutView } from "@vetta-org/theme-ui/chat";
import { ThemeHostProvider } from "@vetta-org/theme-sdk";
import { Button } from "@vetta-org/ui";
import { BrandIcon } from "../../src/renderer/shared/components/BrandIcon";
import { DefaultNewSessionHero } from "../../src/renderer/domains/conversation/components/new-session/NewSessionHero";
import { NewSessionSetupControls } from "../../src/renderer/domains/conversation/components/new-session/NewSessionSetupControls";
import { GuideBadgeSwiper } from "../../src/renderer/domains/conversation/components/GuideBadgeSwiper";
import { createAgentTeamFixture } from "@567agent/agent-team";
import { InputBarView } from "../../src/renderer/domains/conversation/components/input-bar/InputBarView";
import { AbilitiesPageView } from "../../src/renderer/domains/abilities/components/AbilitiesPageView";
import { SkillsPageView } from "../../src/renderer/domains/skills/components/SkillsPageView";
import { KnowledgeBaseListPageView } from "../../src/renderer/domains/knowledge-base/components/KnowledgeBaseListPageView";
import { SidebarBottomBar } from "../../src/renderer/domains/project/components/sidebar/SidebarBottomBar";
import { SettingsPageView } from "../../src/renderer/domains/settings/components/SettingsPageView";
import { DefaultWindowControls } from "@vetta-org/theme-ui/app-shell";
import { SETTINGS_TABS } from "../../src/renderer/domains/settings/registry";
import { applyTheme } from "../../src/renderer/shared/theme/apply";
import { CAPABILITIES_TOUR_STORAGE_KEY } from "../../src/renderer/shared/tour/constants";
import "./fixture.css";

const locales = import.meta.glob("../../src/shared/i18n/locales/{zh,en}/*.json", { eager: true, import: "default" });
const resources = { zh: {}, en: {} };
for (const [path, data] of Object.entries(locales)) {
	const [, language, namespace] = path.match(/\/(zh|en)\/([^/]+)\.json$/);
	resources[language][namespace] = data;
}
await i18n.use(initReactI18next).init({ lng: "zh", resources });
localStorage.setItem(CAPABILITIES_TOUR_STORAGE_KEY, "1");
const record = (event) => window.workspaceEvents.push(event);
const noop = () => {};
const config = {
	defaultModel: "fixture/gemini-flash",
	providers: {
		fixture: {
			baseUrl: "https://models.example.test/v1",
			models: [
				{ id: "gemini-flash", name: "Gemini Flash", contextWindow: 1000000 },
				{ id: "code-model", name: "Code Model" },
			],
		},
	},
};
window.workspaceEvents = [];
window.agent567 = {
	models: { get: async () => config, fetchRemote: async () => ({ providers: {} }) },
	config: { get: async () => ({ defaultAgentMode: "work" }), set: async () => {}, onProjectsChanged: () => noop },
	agentTeams: { list: async () => createAgentTeamFixture(), onChanged: () => noop },
	session: {
		listSandboxGrants: async () => [],
		onSessionsChanged: () => noop,
        continue: async () => record("task-continue"),
        resumeGoal: async () => record("goal-resume"),
		getAgentModes: async () => [
			{
				id: "work",
				label: "办公任务",
				description: "处理文档与日常任务",
				icon: "icon-[solar--case-minimalistic-linear]",
			},
			{ id: "code", label: "编程开发", description: "开发与维护项目", icon: "icon-[solar--code-linear]" },
		],
		onAgentModeChanged: () => noop,
		setGlobalAgentMode: async (id) => record("mode:" + id),
	},
	appMonitor: { recordEvent: noop },
	im: {
		getStatus: async () => ({ transport: "online" }),
		subscribeStatus: async () => noop,
		onSessionChanged: () => noop,
	},
	updater: { sync: async () => {} },
	subscription: { getStatus: async () => ({}) },
};
window.applyWorkspaceTheme = (mode) => applyTheme(mode, "mono");

function Home({ chat = false, task = false }) {
	const streaming = useAtomValue(activeSessionStreamingAtom);
	const [value, setValue] = useState("");
	const [project, setProject] = useState(null);
	const [target, setTarget] = useState(null);
	const [modelKey, setModelKey] = useState("fixture/gemini-flash");
	const model = {
		dropZone: {
			enabled: true,
			dragKind: null,
			labels: { releaseToRef: "松开添加文件", internalRef: "引用文件", externalRef: "添加文件" },
			onDragEnter: noop,
			onDragOver: noop,
			onDragLeave: noop,
			onDrop: noop,
		},
		isStreaming: task && streaming,
		pendingQuestion: undefined,
		pendingMcpElicitation: undefined,
		imageAttachments: [],
		activeActions: [],
		appshotAttachment: null,
		hasSession: true,
		canSend: value.trim().length > 0,
		isEmpty: value.length === 0,
		showPlaceholder: !value,
		hasCapsules: false,
		effectiveCwd: "",
		placeholderTexts: ["描述你想完成的任务…"],
		placeholderRotating: false,
		isFocused: false,
		drawerItems: [],
		drawerActiveTab: null,
		todo: null,
		speechInput: null,
		hasPromptAttachment: false,
		pendingMessageEdit: false,
		pendingEditHint: "",
		cancelPendingEditLabel: "取消",
		contextMenu: null,
		editor: { namespace: "workspace-redesign", value, onValueChange: setValue },
		modelSelector: {
			updateActiveSession: false,
			scope: {
				modelKey,
				onModelSelect: (key) => {
					setModelKey(key);
					record("model:" + key);
				},
				onReasoningSelect: noop,
			},
		},
		leadingTools: [],
		trailingTools: [
			{
				kind: "context-usage",
				model: {
					percent: 18,
					offset: 10,
					color: "var(--primary)",
					isCompacting: false,
					tooltip: "上下文 18%",
					details: null,
				},
			},
		],
		sendBehavior: "direct",
		labels: {
			capsule: {
				removeDefault: "移除",
				removeImage: "移除图片",
				removeTooltip: (path) => path,
				activeGroup: (count) => `${count} 个能力`,
			},
			permission: { deny: "拒绝", allow: "允许", allowSession: "本次会话允许" },
			toolbar: { skills: "能力", addImage: "添加图片", attachFile: "添加文件", queue: "加入队列" },
		},
		actions: {
			setFocused: noop,
			setDrawerActiveTab: noop,
			handleEnter: () => {
				record("send");
				return true;
			},
			handleContextMenu: noop,
			removeImage: noop,
			openImagePreview: noop,
			removePromptAttachment: noop,
			removeAppshot: noop,
			handleSelectImages: async () => record("image"),
			handleSelectFiles: async () => record("file"),
			handleSend: () => record("send"),
			handleAbort: async () => record("task-stop"),
			cancelPendingEdit: noop,
		},
	};
	if (chat) return <ChatSample input={<>{task ? <SessionTaskProgress /> : null}<InputBarView model={model} /></>} />;
	return (
		<NewSessionPageLayoutView
			background={null}
			isShort={false}
			dropZone={(children) => <div className="relative flex min-h-0 flex-1 flex-col">{children}</div>}
			hero={
				<div className="flex w-full flex-col items-center px-2 sm:px-4">
					<DefaultNewSessionHero
						avatarAutoplay={false}
						greetingTitle={i18n.t("chat:newSession.greetingDefault")}
						mounted
						onSceneClick={noop}
						sceneActions={{}}
						sceneLabels={{ installPrompt: "", next: "", previous: "" }}
						scenes={[]}
						selected={null}
						subtitle={i18n.t("chat:newSession.subtitle")}
					/>
				</div>
			}
			inputBar={
				<>
					<InputBarView model={model}>
						<NewSessionSetupControls
							selection={project}
							options={[{ cwd: "/fixture/project", name: "示例项目" }]}
							takenNames={[]}
							creatingProject={false}
							onSelectProject={(cwd) => {
								setProject(cwd ? { kind: "project", cwd, name: "示例项目" } : null);
								record("project:" + cwd);
							}}
							onSelectPendingProject={(name) => setProject({ kind: "pending-create", name })}
							targetKey={target}
							onSelectTarget={setTarget}
						/>
					</InputBarView>
					<div className="mx-auto w-full max-w-2xl px-2 sm:px-4">
						<GuideBadgeSwiper mounted />
					</div>
				</>
			}
		/>
	);
}
function ChatSample({ input }) {
	const [expanded, setExpanded] = useState(false);
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="border-b border-border/60 px-5 py-4">
				<h1 className="text-[14px] font-medium">项目审阅与实施计划</h1>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="@container mx-auto flex max-w-3xl flex-col gap-6 px-5 py-8">
					<Message.Root>
						<MessageLayout.Outgoing>
							<MessageLayout.OutgoingContent>
								<MessageVisual.OutgoingBubble>
									先帮我检查项目结构，再整理一份可以执行的改进计划。
								</MessageVisual.OutgoingBubble>
							</MessageLayout.OutgoingContent>
						</MessageLayout.Outgoing>
					</Message.Root>
					<Message.Root>
						<MessageLayout.Incoming>
							<MessageLayout.Header>
								<Message.Author>567 Agent</Message.Author>
							</MessageLayout.Header>
							<p className="mb-4 text-[14px] leading-relaxed">
								我会先阅读项目入口和现有配置，确认当前实现，再按影响范围整理改进顺序。
							</p>
							<ToolCall.Root
								canExpand
								expanded={expanded}
								exportMode={false}
								onToggle={() => {
									setExpanded(!expanded);
									record("tool-toggle");
								}}
							>
								<ToolCall.Frame>
									<ToolCall.Trigger>
										<ToolCall.StatusIcon
											pending={false}
											icon="icon-[solar--check-circle-linear]"
											iconColorClass="text-muted-foreground"
										/>
										<ToolCall.Name>read</ToolCall.Name>
										<ToolCall.Detail>src/project.ts</ToolCall.Detail>
										<ToolCall.Badge>0.8s</ToolCall.Badge>
										<ToolCall.Chevron />
									</ToolCall.Trigger>
									<ToolCall.Content>
										<pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[12px]">
											export const project = createWorkspace();
										</pre>
									</ToolCall.Content>
								</ToolCall.Frame>
							</ToolCall.Root>
							<p className="mt-5 text-[14px] leading-relaxed">
								已确认当前结构。建议先统一主要入口的布局，再检查窄窗口与键盘操作，最后回归保存、失败恢复和会话切换。
							</p>
						</MessageLayout.Incoming>
					</Message.Root>
				</div>
			</div>
			{input}
		</div>
	);
}
function ChatPreview() {
	return <Home chat />;
}
const recommendations = [
	{
		id: "brief",
		icon: "icon-[solar--document-text-linear]",
		title: "每日工作简报",
		description: "定期整理项目进度、待办和需要关注的变化。",
		scheduleLabel: "工作日 09:00",
	},
	{
		id: "review",
		icon: "icon-[solar--code-linear]",
		title: "项目质量检查",
		description: "检查代码与测试结果，汇总可处理的问题。",
		scheduleLabel: "每周一 10:00",
	},
	{
		id: "research",
		icon: "icon-[solar--magnifer-linear]",
		title: "持续信息研究",
		description: "跟进感兴趣的主题，将新发现整理到工作区。",
		scheduleLabel: "每天 18:00",
	},
];
function Automation() {
	return (
		<AutomationPageView
			hasTasks={false}
			labels={{
				title: "自动化",
				subtitle: "让重复的工作按计划完成。",
				newTask: "新建任务",
				newTaskTitle: "创建自动化任务",
				recommendTitle: "从一个模板开始",
				recommendUse: "使用模板",
			}}
			onNewTask={() => record("new-task")}
			taskList={null}
			historyDrawer={null}
			taskFormDialog={null}
			recommendations={recommendations}
			onSelectRecommendation={(id) => record("template:" + id)}
		/>
	);
}
function Batch() {
	return (
		<BatchTasksPageView
			projectCount={0}
			labels={{
				title: "批量任务",
				subtitle: "分解目标，集中管理多个任务的执行。",
				newProject: "新建项目",
				emptyTitle: "准备好开始一组任务",
				emptyDesc: "创建项目并添加任务，随时查看执行结果。",
				emptyAction: "创建第一个项目",
				statsTotal: "总计",
				statsRunning: "执行中",
				statsCompleted: "完成",
				statsFailed: "失败",
			}}
			stats={{ total: 0, running: 0, completed: 0, failed: 0 }}
			onNewProject={() => record("new-project")}
			list={null}
			dialog={null}
		/>
	);
}
function Settings() {
	return (
		<div className="min-h-0 flex-1 overflow-y-auto">
			<SettingsPageShellView title="工作偏好" description="让工作方式适合你。所有修改沿用现有保存与校验流程。">
				<SettingSection section={{ id: "fixture-appearance" }} title="界面与阅读">
					<SettingRow title="外观模式" description="跟随系统，或选择适合当前环境的明暗主题。">
						<select aria-label="外观模式" className="h-8 rounded-lg border border-border bg-background px-3">
							<option>跟随系统</option>
							<option>浅色</option>
							<option>深色</option>
						</select>
					</SettingRow>
					<SettingRow
						title="较长的设置名称在窄窗口中也应完整展示"
						description="辅助说明会自然换行，操作控件保持可见。"
						border={false}
					>
						<Button variant="outline" onClick={() => record("settings-action")}>
							打开设置
						</Button>
					</SettingRow>
				</SettingSection>
				<SettingSection section={{ id: "fixture-guide" }} title="帮助与入门">
					<SettingRow title="使用指南" description="从常见任务出发，了解模型、附件、画布和协作。" border={false}>
						<Button variant="outline">打开使用指南</Button>
					</SettingRow>
				</SettingSection>
			</SettingsPageShellView>
		</div>
	);
}
const abilityItems = ["代码审阅", "浏览器自动化", "文件与文档", "项目记忆", "图像创作", "研究助手"].map(
	(title, index) => ({
		id: "fixture:" + index,
		slug: "fixture-" + index,
		name: title,
		title,
		description:
			index === 0 ? "长说明用于检查卡片不会随说明无限增长。".repeat(40) : "把常用工作连接到你的会话，按需启用与配置。",
		type: "skill",
		icon: "icon-[solar--widget-4-linear]",
		category: "工作能力",
		tags: [],
		license: "Apache-2.0",
		version: "1.0.0",
		installed: index > 1,
		enabled: index > 1,
		readonly: index > 1,
		needsUpdate: false,
		setupRequired: false,
		busy: false,
		downloadCount: 0,
		isCustom: false,
		isBuiltin: true,
		fromMarket: false,
		searchTerms: [],
	}),
);
function Abilities() {
	const [query, setQuery] = useState("");
	const [scope, setScope] = useState("mine");
	const items = abilityItems.filter((item) => item.name.includes(query));
	const model = {
		scope,
		setScope,
		searchQuery: query,
		setSearchQuery: setQuery,
		typeFilter: "",
		setTypeFilter: noop,
		category: "",
		setCategory: noop,
		reviewFilter: "all",
		setReviewFilter: noop,
		tagFilter: "",
		setTagFilter: noop,
		availableTags: [],
		categories: [],
		installedCount: 4,
		install: (item) => record("ability-install:" + item.id),
		items,
		totalItems: items.length,
		hasMore: false,
		loadMore: noop,
		groups: [],
		allItems: abilityItems,
		loading: false,
		refreshing: false,
		errors: [],
		detailErrors: [],
		importing: false,
		mcp: {
			addingServer: false,
			editingServer: null,
			secretsDialogPreset: null,
			secretsDialogInitial: {},
			saving: false,
			busyPresetName: null,
			secretsDialogAuthorizing: false,
		},
		marketplaceSources: [],
		marketplaceCatalog: { snapshots: [] },
		refresh: noop,
		importSkillArchive: noop,
		importPluginArchive: noop,
		findById: () => null,
	};
	return <AbilitiesPageView model={model} categorized={false} />;
}
function Skills() {
	const [searchQuery, setSearchQuery] = useState("");
	const fileInputRef = useRef(null);
	return (
		<SkillsPageView
			model={{
				searchQuery,
				setSearchQuery,
				loading: false,
				error: null,
				actionStates: {},
				fileInputRef,
				groups: new Map(),
				agentForTab: [],
				hasContent: false,
				handleInstall: noop,
				handleToggle: noop,
				handleUninstall: noop,
				handlePreview: noop,
				handleFileChange: noop,
			}}
		/>
	);
}
function Knowledge() {
	const [search, setSearch] = useState("");
	return (
		<KnowledgeBaseListPageView
			model={{
				fileStatuses: {},
				narrow: false,
				search,
				setSearch,
				knowledgeBases: [],
				filteredBases: [],
				activeId: null,
				goBack: () => record("back"),
				createKnowledgeBase: () => record("new-kb"),
			}}
		/>
	);
}
function AutomationReady() {
	return (
		<AutomationPageView
			hasTasks
			labels={{
				title: "自动化",
				subtitle: "集中查看计划、执行状态与最近结果。",
				newTask: "新建任务",
				newTaskTitle: "创建自动化任务",
			}}
			onNewTask={() => record("new-task")}
			historyDrawer={null}
			taskFormDialog={null}
			taskList={
				<TaskListView
					items={recommendations.map((item, index) => ({
						id: item.id,
						name: item.title,
						prompt: item.description,
						cron: "0 9 * * 1-5",
						enabled: true,
						executionModeLabel: "询问后执行",
						isOnce: false,
						isRunning: index === 0,
						isSelected: false,
						lastRunLabel: "今天 09:00",
						lastRunStatus: index === 2 ? "failed" : "success",
						scheduleLabel: item.scheduleLabel,
						statusLabel: index === 0 ? "正在执行" : "等待下一次运行",
					}))}
					labels={{
						delete: "删除",
						edit: "编辑",
						enable: "启用",
						failed: "失败",
						once: "单次",
						pause: "暂停",
						runNow: "立即执行",
						success: "成功",
					}}
					onDeleteTask={noop}
					onEditTask={noop}
					onRunTask={noop}
					onSelectTask={noop}
					onToggleTask={noop}
				/>
			}
		/>
	);
}
const taskWorkspace = { id: "/fixture/project", cwd: "/fixture/project", runtimeIds: ["fixture-runtime"] };
function TaskWorkspace({ deliveriesOnly = false }) {
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h1 className="border-b border-border/50 px-5 py-3 text-[14px] font-medium">{deliveriesOnly ? "会话交付" : "整理项目资料与检查报告"}</h1>
        <div className="flex min-h-0 flex-1">
            {!deliveriesOnly ? <div className="flex min-w-0 flex-1 flex-col"><Home chat task /></div> : null}
            <aside className={deliveriesOnly ? "min-w-0 flex-1" : "hidden w-80 shrink-0 border-l border-border/50 min-[1000px]:block"}>
                <ActivityPanelContextProvider value={{ workspace: taskWorkspace, knowledgeHistory: false }}><ConversationDeliveries /></ActivityPanelContextProvider>
            </aside>
        </div>
        <ConfirmDialog />
    </div>;
}
function setTaskFixture(page) {
    const store = getDefaultStore();
    store.set(confirmDialogAtom, null);
    store.set(pendingQuestionsAtom, {});
    if (!page.startsWith("task") && page !== "deliveries") { store.set(activeSessionAtom, null); store.set(activeSessionStreamingAtom, false); store.set(chatMessagesAtom, []); return; }
    store.set(activeSessionAtom, { runtimeId: "fixture-runtime", cwd: "/fixture/project", sessionPath: "/fixture/session.jsonl" });
    store.set(activeSessionStreamingAtom, page === "taskRunning" || page === "taskWaiting");
    const blocks = [{ type: "text", id: "text", text: "已整理项目资料：[实施报告](./output/report.md) 与 [项目预览](https://preview.example.test/)" }, { type: "tool_call", toolName: "write", toolCallId: "write", status: "success", args: { path: "output/report.md" }, uiDetails: { writtenPath: "/fixture/project/output/report.md" } }];
    if (page === "taskRunning") blocks.push({ type: "tool_call", toolCallId: "check", toolName: "bash", status: "pending", args: { command: "run checks" }, currentPhase: "正在运行项目检查" });
    if (page === "taskFailed") blocks.push({ type: "error", id: "error", kind: "network", text: "Connection closed", details: { code: "AI_TRANSPORT_FAILED", origin: "provider" } });
    const phase = page === "taskFailed" ? "failed" : page === "taskStopped" ? "aborted" : page === "taskRunning" || page === "taskWaiting" ? "streaming" : "completed";
    store.set(chatMessagesAtom, [{ kind: "agent", role: "assistant", id: "reply", entryId: "entry", turnId: "turn", authorId: "agent", phase, blocks, startedAt: Date.now() - 125000 }]);
    if (page === "taskWaiting") store.set(pendingQuestionsAtom, { "fixture-runtime": { requestId: "q", sessionId: "fixture-runtime", questions: [] } });
}
const pages = {
    taskRunning: TaskWorkspace, taskWaiting: TaskWorkspace, taskFailed: TaskWorkspace, taskStopped: TaskWorkspace, taskComplete: TaskWorkspace, deliveries: () => <TaskWorkspace deliveriesOnly />,
	chat: ChatPreview,
	home: Home,
	automation: Automation,
	automationReady: AutomationReady,
	batch: Batch,
	settings: Settings,
	abilities: Abilities,
	skills: Skills,
	knowledge: Knowledge,
};
function Fixture({ page, shell }) {
	const View = pages[page];
	const navItems = Object.entries({
		home: "新会话",
		abilities: "能力",
		automation: "自动化",
		batch: "批量任务",
		knowledge: "知识库",
	}).map(([key, label]) => ({
		key,
		label,
		icon: "icon-[solar--widget-4-linear]",
		type: key === "home" ? "new-session" : "route",
		path: "/" + key,
		active: page === key,
	}));
	const content = <View />;
	if (page === "settings")
		return (
			<AppFrame data-workspace-page={page} data-sidebar-visible="false">
				<MainContentFrame
					header={
						<div className="drag-region flex h-11 items-center justify-between px-2">
							<Button className="no-drag" variant="ghost" size="sm" onClick={() => record("return-workspace")}>
								← 返回工作区
							</Button>
							<DefaultWindowControls
								model={{
									isMac: false,
									isMaximized: false,
									controls: [
										{ kind: "minimize", label: "最小化", action: () => record("window:minimize") },
										{ kind: "maximize", label: "最大化", action: () => record("window:maximize") },
										{ kind: "close", label: "关闭", action: () => record("window:close") },
									],
								}}
							/>
						</div>
					}
				>
					<SettingsPageView
						content={content}
						model={{
							activeTab: "general",
							title: "设置",
							narrow: innerWidth < 720,
							tabs: SETTINGS_TABS.filter((tab) => !tab.macOnly && !tab.requireAuth).map((tab) => ({
								...tab,
								label: i18n.t("settings:" + tab.labelKey),
							})),
							betaBadgeLabel: "BETA",
							onSelectTab: (tab) => record("settings-tab:" + tab),
							onSelectNavigationChild: noop,
							onCloseEmbeddedView: noop,
						}}
					/>
				</MainContentFrame>
			</AppFrame>
		);
	if (!shell)
		return (
			<div data-workspace-page={page} className="flex h-screen min-w-0 flex-col overflow-hidden bg-background">
				{content}
			</div>
		);
	return (
		<AppFrame data-workspace-page={page}>
			{
				<SidebarPanel width={220} onResize={noop} onResizeEnd={noop}>
					<SidebarTopBar
						brandName="567 Agent"
						brandIcon={<BrandIcon className="h-5 w-5" />}
						floating={false}
						labels={{ hide: "收起侧栏" }}
					/>
					<SidebarNavigation
						items={navItems}
						indicatorBounds={null}
						onItemClick={(item) => record("nav:" + item.key)}
						setItemRef={() => noop}
					/>
					<div className="min-h-0 flex-1 border-t border-border/50 px-4 py-4 text-[12px] text-muted-foreground">
						<p className="mb-4">项目与对话</p>
						{["产品设计与体验", "分析项目代码", "整理工作计划"].map((name) => (
							<p className="py-2" key={name}>
								{name}
							</p>
						))}
					</div>
					<SidebarBottomBar />
				</SidebarPanel>
			}
			<MainContentFrame header={<div className="drag-region h-8" />}>{content}</MainContentFrame>
		</AppFrame>
	);
}
const root = createRoot(document.getElementById("root"));
window.renderWorkspace = ({ page, shell = false }) => {
    setTaskFixture(page);
	root.render(
		<ThemeHostProvider host={{}}>
			<Fixture key={page + shell} page={page} shell={shell} />
		</ThemeHostProvider>,
	);
};
