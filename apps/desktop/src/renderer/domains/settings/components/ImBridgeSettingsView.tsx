import type { ImBridgeConfig, ImTransportSelector, ImTransportStatus } from "@preload/api";
import { ModelSelect } from "@shared/components/ModelSelect";
import { Button, Switch, cn } from "@vetta-org/ui";
import {
	ImChannelIconView,
	ImStatusBadgeView,
	SettingHeading,
	SettingRow,
	SettingSection,
} from "@vetta-org/theme-ui/settings";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { ImChannelCard } from "./ImChannelCard";
import { FeishuBindDialog } from "./FeishuBindDialog";
import { ImFeishuDialog } from "./ImFeishuDialog";
import { ImLegacyImportBanner } from "./ImLegacyImportBanner";
import { ImLogDrawer } from "./ImLogDrawer";
import { ImStatusBadge } from "./ImStatusBadge";
import {
	IM_CHANNELS,
	isImChannelConfigured,
	type ImChannelDescriptor,
	type ImGenericChannelTransport,
} from "./im-channel-catalog";
import type { ImBridgeSettingsModel } from "./useImBridgeSettingsModel";
import { ImChannelConfigDialog } from "./ImChannelConfigDialog";
import { ImChannelGuideDialog } from "./ImChannelGuideDialog";
import { SignalBindDialog } from "./SignalBindDialog";
import { WechatBindDialog } from "./WechatBindDialog";

const GENERIC_CHANNEL_DESC_KEY = {
	telegram: "imChannelDialogDesc.telegram",
	slack: "imChannelDialogDesc.slack",
	discord: "imChannelDialogDesc.discord",
	signal: "imChannelDialogDesc.signal",
	whatsapp: "imChannelDialogDesc.whatsapp",
	imessage: "imChannelDialogDesc.imessage",
} as const satisfies Record<ImGenericChannelTransport, string>;

const STATUS_LABEL_KEY: Record<ImTransportStatus, string> = {
	offline: "imbStatusOffline",
	connecting: "imbStatusConnecting",
	online: "imbStatusOnline",
	error: "imbStatusError",
	awaiting_bind: "imbStatusAwaitingBind",
};

const LIVE_CHIP_PRIORITY: Record<ImTransportStatus, number> = {
	error: 0,
	connecting: 1,
	awaiting_bind: 2,
	online: 3,
	offline: 4,
};

export type ImChannelStatusesMap = Partial<Record<ImTransportSelector, ImTransportStatus>>;

interface ChannelPresentation {
	readonly name: string;
	readonly subtitle: string;
	readonly configureLabel: string;
	readonly onConfigure: () => void;
}

interface ResolvedChannelState {
	readonly configured: boolean;
	readonly channelStatus: ImTransportStatus | undefined;
	readonly statusPending: boolean;
	readonly liveStatus: ImTransportStatus | undefined;
}

function resolveChannelState(
	config: ImBridgeConfig,
	channel: ImChannelDescriptor,
	channelStatuses: ImChannelStatusesMap | undefined,
	legacyTransportStatus: ImTransportStatus,
): ResolvedChannelState {
	const configured = isImChannelConfigured(config, channel.transport);
	if (!config.enabled) {
		return { configured, channelStatus: undefined, statusPending: false, liveStatus: undefined };
	}
	const hasExplicitMap = channelStatuses !== undefined;
	const explicitStatus = channelStatuses?.[channel.transport];
	// 兼容尚未提供 channelStatuses 的旧版模型：仅对 legacy default transport 回退，
	// 不把单渠道状态泛化到其他已配置渠道，也不凭凭据推断在线。
	const compatStatus =
		!hasExplicitMap &&
		config.transport === channel.transport
			? legacyTransportStatus
			: undefined;
	const resolved = explicitStatus ?? compatStatus;

	if (resolved !== undefined) {
		const isNotableUnconfigured = resolved === "awaiting_bind" || resolved === "error";
		if (!configured && !isNotableUnconfigured) {
			return { configured, channelStatus: undefined, statusPending: false, liveStatus: undefined };
		}
		return { configured, channelStatus: resolved, statusPending: false, liveStatus: resolved };
	}

	if (configured) {
		return { configured, channelStatus: undefined, statusPending: true, liveStatus: undefined };
	}

	return { configured, channelStatus: undefined, statusPending: false, liveStatus: undefined };
}

export function ImBridgeSettingsView({
	model,
	children,
}: {
	model: ImBridgeSettingsModel;
	children?: ReactNode;
}): JSX.Element {
	const { t } = useTranslation("settings");
	const config = model.config;

	if (!config) {
		return (
			<div className="mx-auto w-full max-w-[800px] px-5 pt-6 sm:px-8 pb-4">
				<h1 className="mb-6 text-[24px] font-semibold tracking-tight text-foreground">567 Claw</h1>
				<div className="text-[13px] text-muted-foreground">{t("loadFailed")}</div>
				{children && <div className="mt-6">{children}</div>}
			</div>
		);
	}

	const describe = (channel: ImChannelDescriptor): ChannelPresentation => {
		switch (channel.dialogKind) {
			case "feishu":
				return {
					name: t("feishuName"),
					subtitle: config.feishu.appId ? `${t("bound")} (${config.feishu.appId})` : t("feishuSubtitle"),
					configureLabel: config.feishu.appId ? t("feishuManage") : t("feishuBind"),
					onConfigure: model.onOpenFeishuBindDialog,
				};
			case "wechat":
				return {
					name: t("wechatName"),
					subtitle: config.wechat.bound
						? `${t("bound")} (${config.wechat.ilinkBotId ?? "iLink"})`
						: t("wechatSubtitle"),
					configureLabel: config.wechat.bound ? t("wechatManage") : t("wechatBind"),
					onConfigure: model.onOpenWechatDialog,
				};
			case "signal":
				return {
					name: channel.brandName,
					subtitle: config.signal.bound
						? `${t("bound")}${config.signal.account ? ` (${config.signal.account})` : ""}`
						: t("signalSubtitle"),
					configureLabel: config.signal.bound ? t("signalManage") : t("signalBind"),
					onConfigure: model.onOpenSignalDialog,
				};
			case "generic":
				return {
					name: channel.brandName,
					subtitle: t(GENERIC_CHANNEL_DESC_KEY[channel.transport]),
					configureLabel: t("configureChannel"),
					onConfigure: () => model.onOpenChannelDialog(channel.transport),
				};
		}
	};

	const channelStatuses = model.channelStatuses;
	const channelEntries = IM_CHANNELS.map((channel) => ({
		channel,
		presentation: describe(channel),
		state: resolveChannelState(config, channel, channelStatuses, model.transportStatus),
	}));
	const configuredCount = channelEntries.filter((entry) => entry.state.configured).length;
	const liveEntries = channelEntries
		.filter(
			(entry): entry is typeof entry & { state: { liveStatus: ImTransportStatus } } =>
				entry.state.liveStatus !== undefined,
		)
		.sort((left, right) => LIVE_CHIP_PRIORITY[left.state.liveStatus] - LIVE_CHIP_PRIORITY[right.state.liveStatus]);

	const onlineCount = liveEntries.filter((entry) => entry.state.liveStatus === "online").length;
	const connectingCount = liveEntries.filter((entry) => entry.state.liveStatus === "connecting").length;
	const errorCount = liveEntries.filter((entry) => entry.state.liveStatus === "error").length;
	const awaitingCount = liveEntries.filter((entry) => entry.state.liveStatus === "awaiting_bind").length;

	const overviewDescription = !config.enabled
		? configuredCount > 0
			? t("imbOverviewDisabledDesc")
			: t("imbOverviewNoChannelsDesc")
		: configuredCount === 0 && liveEntries.length === 0
			? t("imbOverviewNoChannelsDesc")
			: liveEntries.length > 0
				? t("imbOverviewRunningDesc", { configured: configuredCount })
				: t("imbOverviewPendingDesc", { configured: configuredCount });

	const diagnosticStateBadge = config.enabled && model.transportStatus === "online" ? (
		<ImStatusBadgeView status="online" label={t("imbBridgeEnabled")} />
	) : (
		<ImStatusBadge status={config.enabled ? model.transportStatus : "offline"} />
	);

	const consecutiveFailures = model.status?.consecutiveStartFailures ?? 0;
	const hasDiagnosticIssue = Boolean(model.status?.lastError) || consecutiveFailures > 0;
	const feedback = model.saveError ?? model.saveOk;
	const feedbackIsError = model.saveError !== null;

	return (
		<div className="mx-auto w-full max-w-[800px] px-5 pt-6 sm:px-8 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-[24px] font-semibold tracking-tight text-foreground">567 Claw</h1>
				<SettingsAiAssist tabId="im" />
			</div>

			{model.legacy?.hasLegacyData && (
				<ImLegacyImportBanner
					legacy={model.legacy}
					importing={model.importing}
					onImport={model.onImportLegacy}
					onSkip={model.onSkipLegacy}
				/>
			)}

			{feedback && (
				<div
					role="status"
					className={cn(
						"mb-4 flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12px]",
						feedbackIsError
							? "border-destructive/40 bg-destructive/10 text-destructive"
							: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
					)}
				>
					<span
						className={cn(
							feedbackIsError ? "icon-[solar--danger-triangle-linear]" : "icon-[solar--check-circle-linear]",
							"mt-px h-3.5 w-3.5 shrink-0",
						)}
					/>
					<span className="min-w-0 flex-1">{feedback}</span>
					<Button
						variant="ghost"
						size="icon-xs"
						aria-label={t("imbDismissMessage")}
						title={t("imbDismissMessage")}
						onClick={model.onDismissFeedback}
					>
						<span className="icon-[solar--close-circle-linear] h-3 w-3" />
					</Button>
				</div>
			)}

			{/* 基础控制与运行概览：多渠道状态汇总 + 总开关 + 共用对话模型 */}
			<SettingSection section={SETTINGS_SECTION["imbridge-basics"]} title={false}>
				<div className="border-b border-border px-5 py-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="min-w-0 flex-1 basis-52">
							<div className="flex flex-wrap items-center gap-2">
								<span className="text-[14px] font-semibold text-foreground">{t("imbOverviewTitle")}</span>
								{!config.enabled ? (
									<ImStatusBadge status="offline" />
								) : (
									<div className="flex flex-wrap items-center gap-1.5">
										{onlineCount > 0 && (
											<ImStatusBadgeView
												status="online"
												label={t("imbOverviewOnlineSummary", { count: onlineCount })}
											/>
										)}
										{connectingCount > 0 && (
											<ImStatusBadgeView
												status="connecting"
												label={t("imbOverviewConnectingSummary", { count: connectingCount })}
											/>
										)}
										{errorCount > 0 && (
											<ImStatusBadgeView
												status="error"
												label={t("imbOverviewErrorSummary", { count: errorCount })}
											/>
										)}
										{awaitingCount > 0 && (
											<ImStatusBadgeView
												status="awaiting_bind"
												label={t("imbOverviewAwaitingSummary", { count: awaitingCount })}
											/>
										)}
										{onlineCount === 0 && connectingCount === 0 && errorCount === 0 && awaitingCount === 0 && (
											<ImStatusBadgeView
												status="offline"
												label={t("imbOverviewConfiguredSummary", { count: configuredCount })}
											/>
										)}
									</div>
								)}
							</div>
							<p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{overviewDescription}</p>
						</div>
					</div>
					{liveEntries.length > 0 && (
						<div className="mt-3 flex flex-wrap items-center gap-2">
							{liveEntries.map(({ channel, presentation, state }) => (
								<Button
									key={channel.transport}
									variant="outline"
									size="xs"
									onClick={presentation.onConfigure}
									className={cn(
										"h-7 gap-1.5 rounded-full px-2.5 text-[11px]",
										state.liveStatus === "error" && "border-destructive/40 hover:border-destructive/60",
									)}
								>
									<ImChannelIconView
										icon={channel.icon}
										isActive={state.liveStatus === "online"}
										className="h-4 w-4 rounded-md"
									/>
									<span className="font-medium text-foreground">{presentation.name}</span>
									<span
										className={cn(
											"h-1.5 w-1.5 rounded-full",
											state.liveStatus === "online"
												? "bg-emerald-400"
												: state.liveStatus === "connecting"
													? "bg-amber-400"
													: state.liveStatus === "error"
														? "bg-destructive"
														: state.liveStatus === "awaiting_bind"
															? "bg-primary"
															: "bg-muted-foreground",
										)}
									/>
									<span
										className={cn(
											state.liveStatus === "online"
												? "text-emerald-400"
												: state.liveStatus === "connecting"
													? "text-amber-400"
													: state.liveStatus === "error"
														? "text-destructive"
														: state.liveStatus === "awaiting_bind"
															? "text-primary"
															: "text-muted-foreground",
										)}
									>
										{t(STATUS_LABEL_KEY[state.liveStatus] as "imbStatusOffline")}
									</span>
								</Button>
							))}
						</div>
					)}
				</div>
				<SettingRow title={t("enableImBridge")} description={t("enableImBridgeDesc")}>
					<Switch
						checked={config.enabled}
						onCheckedChange={(checked) => void model.onToggleEnabled(checked)}
						disabled={model.saving}
					/>
				</SettingRow>
				<SettingRow title={t("dialogModel")} description={t("dialogModelDesc")} border={false}>
					<div className="flex flex-col items-end gap-1.5">
						<div className="flex flex-wrap items-center justify-end gap-2">
							<ModelSelect
								value={config.agentModel ? `${config.agentModel.provider}/${config.agentModel.model}` : null}
								onChange={(key) => {
									if (!key) {
										void model.onPickModel(null);
										return;
									}
									const sep = key.indexOf("/");
									if (sep < 0) return;
									void model.onPickModel({ provider: key.slice(0, sep), model: key.slice(sep + 1) });
								}}
								allowClear
								disabled={model.saving}
								placeholder={t("notSet")}
								triggerClassName="h-8 min-w-[220px] rounded-lg border-border bg-card px-2.5 text-[12px] font-medium hover:bg-accent data-[state=open]:bg-accent"
								reasoning={
									config.agentModel
										? {
												value: config.agentModel.reasoningLevel,
												onChange: (level) => {
													const agentModel = model.config?.agentModel;
													if (agentModel) {
														void model.onPickModel({
															provider: agentModel.provider,
															model: agentModel.model,
															reasoningLevel: level,
														});
													}
												},
											}
										: undefined
								}
							/>
							<Button
								variant="outline"
								size="sm"
								onClick={() => void model.onProbeModel()}
								disabled={model.probing || !config.agentModel}
							>
								<span>{t("testConnect")}</span>
								{model.probing ? (
									<span className="icon-[mdi--loading] h-3.5 w-3.5 animate-spin" />
								) : model.probeResult?.ok ? (
									<span className="icon-[mdi--check] h-3.5 w-3.5 text-emerald-400" />
								) : model.probeResult && !model.probeResult.ok ? (
									<span className="icon-[mdi--close] h-3.5 w-3.5 text-destructive" />
								) : null}
							</Button>
						</div>
						{model.probeResult?.msg && (
							<p
								className={cn(
									"text-right text-[11px]",
									model.probeResult.ok ? "text-emerald-400" : "text-destructive",
								)}
							>
								{model.probeResult.msg}
							</p>
						)}
					</div>
				</SettingRow>
			</SettingSection>

			{/* 消息渠道：多渠道独立展示状态，点击任意卡片直接绑定或管理 */}
			<div className="mb-6 p-1.5" data-setting-section-highlight-target={SETTINGS_SECTION["imbridge-channels"].id}>
				<div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
					<SettingHeading section={SETTINGS_SECTION["imbridge-channels"]} title={t("section_imbridge-channels")} />
					<span className="text-[12px] text-muted-foreground">
						{t("channelsConfiguredCount", { configured: configuredCount, total: IM_CHANNELS.length })}
					</span>
				</div>
				<p className="mb-3 text-[12px] text-muted-foreground">{t("channelsMultiActiveHint")}</p>
				<div className="grid grid-cols-[repeat(auto-fill,minmax(min(210px,100%),1fr))] gap-3">
					{channelEntries.map(({ channel, presentation, state }) => (
						<ImChannelCard
							key={channel.transport}
							name={presentation.name}
							subtitle={presentation.subtitle}
							icon={channel.icon}
							configured={state.configured}
							bridgeEnabled={config.enabled}
							channelStatus={state.channelStatus}
							statusPending={state.statusPending}
							configureLabel={presentation.configureLabel}
							onConfigure={presentation.onConfigure}
						/>
					))}
				</div>
			</div>

			<ImFeishuDialog model={model} />
			<FeishuBindDialog
				onOpenGuide={() => model.setGuideTransport("feishu")}
				open={model.feishuBindDialogOpen}
				onOpenChange={model.setFeishuBindDialogOpen}
				bound={Boolean(config.feishu.appId)}
				appId={config.feishu.appId || undefined}
				onLogout={() => void model.onClearChannel("feishu")}
				onConfirmedRefresh={model.onFeishuConfirmedRefresh}
				onOpenManual={model.onOpenFeishuDialog}
			/>
			<ImChannelConfigDialog
				model={model.channelDialog}
				onOpenGuide={(transport) => model.setGuideTransport(transport)}
			/>
			<WechatBindDialog
				onOpenGuide={() => model.setGuideTransport("wechat")}
				open={model.wechatDialogOpen}
				onOpenChange={model.setWechatDialogOpen}
				bound={config.wechat.bound}
				ilinkBotId={config.wechat.ilinkBotId}
				ilinkUserId={config.wechat.ilinkUserId}
				onLogout={() => void model.onWechatLogout()}
				onConfirmedRefresh={model.onWechatConfirmedRefresh}
			/>
			<SignalBindDialog
				onOpenGuide={() => model.setGuideTransport("signal")}
				open={model.signalDialogOpen}
				onOpenChange={model.setSignalDialogOpen}
				bound={config.signal.bound}
				account={config.signal.account}
				cliDetectedPath={config.signal.cliDetectedPath}
				cliInstallHint={config.signal.cliInstallHint}
				onLogout={() => void model.onSignalLogout()}
				onConfirmedRefresh={model.onSignalConfirmedRefresh}
				onOpenAdvanced={() => model.onOpenChannelDialog("signal")}
			/>
			<ImChannelGuideDialog transport={model.guideTransport} onClose={() => model.setGuideTransport(null)} />

			{/* 诊断与运行操作：桥接进程状态、异常详情与日志入口 */}
			<SettingSection section={SETTINGS_SECTION["imbridge-status"]} title={t("section_imbridge-status")}>
				<div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
					<div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
						<span className="inline-flex items-center gap-2 text-muted-foreground">
							<span>{t("imbBridgeStateLabel")}</span>
							{diagnosticStateBadge}
						</span>
						<span className="text-muted-foreground">
							{t("bridgePid")}
							<span className="ml-1.5 tabular-nums text-foreground">{model.status?.sidecarPid ?? "—"}</span>
						</span>
						<span className="text-muted-foreground">
							{t("imbActiveSessions")}
							<span className="ml-1.5 tabular-nums text-foreground">{model.status?.activeSessions ?? 0}</span>
						</span>
					</div>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" onClick={() => void model.onOpenLogs()}>
							<span className="icon-[solar--document-text-linear] h-3.5 w-3.5" />
							{t("viewLogs")}
						</Button>
						<Button variant="outline" size="sm" onClick={() => void model.onRestart()} disabled={!config.enabled}>
							<span className="icon-[solar--restart-linear] h-3.5 w-3.5" />
							{t("restartBridgeBtn")}
						</Button>
					</div>
				</div>
				{hasDiagnosticIssue && (
					<div className="flex flex-wrap items-start gap-2 border-t border-border bg-destructive/5 px-5 py-3 text-[12px] text-destructive">
						<span className="icon-[solar--danger-triangle-linear] mt-0.5 h-3.5 w-3.5 shrink-0" />
						<div className="min-w-0 flex-1 space-y-0.5">
							{model.status?.lastError && <div className="break-words">{model.status.lastError}</div>}
							<div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
								{model.status?.lastErrorAt && <span className="tabular-nums">{model.status.lastErrorAt}</span>}
								{consecutiveFailures > 0 && (
									<span>{t("imbConsecutiveFailures", { count: consecutiveFailures })}</span>
								)}
							</div>
						</div>
					</div>
				)}
			</SettingSection>

			{children}

			{model.logsOpen && <ImLogDrawer logs={model.logs} onClose={() => model.setLogsOpen(false)} />}
		</div>
	);
}
