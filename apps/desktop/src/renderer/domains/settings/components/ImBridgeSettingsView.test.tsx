// @vitest-environment jsdom
import type { ImBridgeConfig } from "@preload/api";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({ t: (key: string) => key, i18n: { exists: () => true } }),
}));
vi.mock("@shared/components/ModelSelect", () => ({ ModelSelect: () => <div data-testid="model-select" /> }));
vi.mock("../ai-assist", () => ({ SettingsAiAssist: () => null }));
vi.mock("./ImFeishuDialog", () => ({ ImFeishuDialog: () => null }));
vi.mock("./ImChannelConfigDialog", () => ({ ImChannelConfigDialog: () => null }));
vi.mock("./WechatBindDialog", () => ({ WechatBindDialog: () => null }));
vi.mock("./ImLogDrawer", () => ({ ImLogDrawer: () => null }));
vi.mock("./ImLegacyImportBanner", () => ({ ImLegacyImportBanner: () => null }));

const { ImBridgeSettingsView } = await import("./ImBridgeSettingsView.js");
const { IM_CHANNELS } = await import("./im-channel-catalog.js");
type Model = Parameters<typeof ImBridgeSettingsView>[0]["model"];

function config(overrides: Partial<ImBridgeConfig> = {}): ImBridgeConfig {
	return {
		enabled: false,
		transport: "feishu",
		feishu: { appId: "cli_a", appSecret: "sec", verificationToken: "", encryptKey: "" },
		wechat: { bound: false },
		telegram: { botToken: "" },
		slack: { botToken: "", appToken: "" },
		discord: { botToken: "" },
		signal: { bound: false, cliInstallHint: "brew install signal-cli" },
		whatsapp: { bound: false },
		imessage: {},
		transportMode: "long-connection",
		encryptionAvailable: true,
		...overrides,
	};
}

function model(overrides: Partial<Model> = {}): Model {
	return {
		config: config(),
		channelDialog: {
			transport: null,
			form: { botToken: "", appToken: "", endpoint: "", account: "", attachmentsDir: "", path: "", allowlist: "" },
			open: false,
			showSecret: false,
			busy: false,
			error: null,
			message: null,
			setOpen: vi.fn(),
			setShowSecret: vi.fn(),
			updateField: vi.fn(),
			onSave: vi.fn(),
			onTest: vi.fn(),
			onBind: vi.fn(),
			onLogout: vi.fn(),
		},
		feishuForm: { appId: "", appSecret: "" },
		feishuValidation: { errors: {}, valid: true },
		feishuDialogOpen: false,
		wechatDialogOpen: false,
		status: null,
		transportStatus: "online",
		showSecret: false,
		saving: false,
		saveError: null,
		saveOk: null,
		testing: false,
		testResult: null,
		logsOpen: false,
		logs: [],
		legacy: null,
		importing: false,
		probing: false,
		probeResult: null,
		setFeishuDialogOpen: vi.fn(),
		setWechatDialogOpen: vi.fn(),
		setShowSecret: vi.fn(),
		setLogsOpen: vi.fn(),
		updateFeishuField: vi.fn(),
		onImportLegacy: vi.fn(),
		onSkipLegacy: vi.fn(),
		onPickModel: vi.fn(),
		onProbeModel: vi.fn(),
		onToggleEnabled: vi.fn(),
		onSwitchTransport: vi.fn(),
		onOpenFeishuDialog: vi.fn(),
		onOpenWechatDialog: vi.fn(),
		onOpenChannelDialog: vi.fn(),
		onWechatLogout: vi.fn(),
		onSaveFeishu: vi.fn(),
		onTestFeishu: vi.fn(),
		onRestart: vi.fn(),
		onOpenLogs: vi.fn(),
		onWechatConfirmedRefresh: vi.fn(),
		onDismissFeedback: vi.fn(),
		...overrides,
	} as Model;
}

describe("ImBridgeSettingsView", () => {
	it("渲染全部八个渠道与设置锚点，不显示单渠道活动卡与切换暗示", () => {
		const view = render(
			<ImBridgeSettingsView
				model={model({
					config: config({ enabled: false }),
					transportStatus: "offline",
				})}
			>
				<div data-testid="notifications-child" />
			</ImBridgeSettingsView>,
		);
		expect(view.getByText("Telegram")).toBeDefined();
		expect(view.getByText("Slack")).toBeDefined();
		expect(view.getByText("Discord")).toBeDefined();
		expect(view.getByText("Signal")).toBeDefined();
		expect(view.getByText("WhatsApp")).toBeDefined();
		expect(view.getByText("iMessage")).toBeDefined();
		expect(view.getByText("feishuName")).toBeDefined();
		expect(view.getByText("wechatName")).toBeDefined();
		expect(view.getByTestId("notifications-child")).toBeDefined();
		expect(view.queryByText(/imbActiveChannel/)).toBeNull();
		expect(view.queryByText("channelsSingleActiveHint")).toBeNull();
		expect(view.queryByText("channelActive")).toBeNull();
		expect(view.container.querySelector('[data-setting-section-id="imbridge-basics"]')).not.toBeNull();
		expect(
			view.container.querySelector('[data-setting-section-highlight-target="imbridge-channels"]'),
		).not.toBeNull();
		expect(view.container.querySelector('[data-setting-section-id="imbridge-status"]')).not.toBeNull();
		for (const channel of IM_CHANNELS.filter((item) => item.dialogKind === "generic")) {
			expect(view.getByRole("button", { name: `${channel.brandName} · configureChannel` })).toBeDefined();
		}
	});

	it("多渠道同时在线、连接中、异常时，概览与渠道卡均展示各自真实状态", async () => {
		const onOpenChannelDialog = vi.fn();
		const onOpenWechatDialog = vi.fn();
		const view = render(
			<ImBridgeSettingsView
				model={model({
					config: config({
						enabled: true,
						transport: "wechat",
						wechat: { bound: true, ilinkBotId: "bot_1" },
						telegram: { botToken: "tg_tok" },
						slack: { botToken: "xoxb", appToken: "xapp" },
						discord: { botToken: "dc_tok" },
					}),
					channelStatuses: {
						wechat: "online",
						telegram: "online",
						slack: "connecting",
						discord: "error",
					},
					onOpenChannelDialog,
					onOpenWechatDialog,
				})}
			/>,
		);

		expect(view.getByText("imbOverviewOnlineSummary")).toBeDefined();
		expect(view.getByText("imbOverviewConnectingSummary")).toBeDefined();
		expect(view.getByText("imbOverviewErrorSummary")).toBeDefined();
		// 微信与 Telegram 在概览状态条和渠道卡中均显示在线
		expect(view.getAllByText("imbStatusOnline").length).toBeGreaterThanOrEqual(4);
		expect(view.getAllByText("imbStatusConnecting").length).toBeGreaterThanOrEqual(2);
		expect(view.getAllByText("imbStatusError").length).toBeGreaterThanOrEqual(2);

		// 点击概览区异常渠道芯片可直接打开对应渠道配置
		await userEvent.click(view.getByRole("button", { name: /Discord.*imbStatusError/ }));
		expect(onOpenChannelDialog).toHaveBeenCalledWith("discord");

		await userEvent.click(view.getByRole("button", { name: "wechatName · wechatManage" }));
		expect(onOpenWechatDialog).toHaveBeenCalledTimes(1);
	});

	it("有凭据但缺少状态时显示待确认或已配置，不凭凭据推断在线", () => {
		const enabledView = render(
			<ImBridgeSettingsView
				model={model({
					config: config({
						enabled: true,
						transport: "wechat",
						wechat: { bound: true },
						telegram: { botToken: "tg_tok" },
					}),
					channelStatuses: {
						wechat: "online",
					},
				})}
			/>,
		);

		expect(enabledView.getAllByText("imbStatusOnline")).toHaveLength(2);
		expect(enabledView.getAllByText("channelPendingStatus").length).toBeGreaterThanOrEqual(1);
		enabledView.unmount();

		const disabledView = render(
			<ImBridgeSettingsView
				model={model({
					config: config({
						enabled: false,
						wechat: { bound: true },
						telegram: { botToken: "tg_tok" },
					}),
					channelStatuses: {},
					transportStatus: "offline",
				})}
			/>,
		);

		expect(disabledView.queryByText("imbStatusOnline")).toBeNull();
		expect(disabledView.getAllByText("channelConfigured").length).toBeGreaterThanOrEqual(2);
	});

	it("未提供 channelStatuses 时保留 model.transportStatus 兼容且不泛化到其他渠道", () => {
		const view = render(
			<ImBridgeSettingsView
				model={model({
					config: config({
						enabled: true,
						transport: "feishu",
						telegram: { botToken: "tg_tok" },
					}),
					transportStatus: "online",
				})}
			/>,
		);

		// 仅 legacy default transport (feishu) 回退显示在线（概览芯片 + 卡片），Telegram 显示待确认
		expect(view.getAllByText("imbStatusOnline")).toHaveLength(2);
		expect(view.getAllByText("channelPendingStatus").length).toBeGreaterThanOrEqual(1);
	});

	it("诊断区呈现运行错误且保留诊断与模型交互", async () => {
		const onProbeModel = vi.fn();
		const onOpenLogs = vi.fn();
		const view = render(
			<ImBridgeSettingsView
				model={model({
					config: config({
						enabled: true,
						agentModel: { provider: "openai", model: "gpt-5" },
						wechat: { bound: true },
					}),
					transportStatus: "error",
					channelStatuses: { wechat: "offline" },
					status: {
						transport: "offline",
						activeSessions: 2,
						sidecarPid: 4321,
						consecutiveStartFailures: 1,
						lastError: "socket closed",
					},
					probeResult: { ok: true, msg: "模型连通正常" },
					onProbeModel,
					onOpenLogs,
				})}
			/>,
		);

		expect(view.getByText("imbStatusError")).toBeDefined();
		expect(view.getByText("4321")).toBeDefined();
		expect(view.getByText("socket closed")).toBeDefined();
		expect(view.getByText("模型连通正常")).toBeDefined();

		await userEvent.click(view.getByRole("button", { name: "testConnect" }));
		expect(onProbeModel).toHaveBeenCalledTimes(1);

		await userEvent.click(view.getByRole("button", { name: "viewLogs" }));
		expect(onOpenLogs).toHaveBeenCalledTimes(1);
	});

	it("点击已配置渠道卡直接打开管理或配置弹窗，不触发旧活动渠道切换", async () => {
		const onSwitchTransport = vi.fn();
		const onOpenChannelDialog = vi.fn();
		const view = render(
			<ImBridgeSettingsView
				model={model({
					onSwitchTransport,
					onOpenChannelDialog,
					config: config({ telegram: { botToken: "tok" } }),
				})}
			/>,
		);

		await userEvent.click(view.getByRole("button", { name: "Telegram · configureChannel" }));

		expect(onOpenChannelDialog).toHaveBeenCalledWith("telegram");
		expect(onSwitchTransport).not.toHaveBeenCalled();
	});

	it("保存失败时在页面上给出可见反馈，并可关闭", async () => {
		const onDismissFeedback = vi.fn();
		const view = render(
			<ImBridgeSettingsView model={model({ saveError: "请先选择对话模型", onDismissFeedback })} />,
		);

		expect(view.getByRole("status").textContent).toContain("请先选择对话模型");
		await userEvent.click(view.getByRole("button", { name: "imbDismissMessage" }));

		expect(onDismissFeedback).toHaveBeenCalledTimes(1);
	});

	it("没有反馈消息时不渲染提示条", () => {
		const view = render(<ImBridgeSettingsView model={model()} />);
		expect(view.queryByRole("status")).toBeNull();
	});
});
