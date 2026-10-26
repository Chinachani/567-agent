import { CurrentScenarioActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { motion, useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@shared/lib/utils";
import { useThemeComponent } from "@vetta-org/theme-sdk";
import type { NewSessionHeroIdentity } from "@vetta-org/theme-ui";
import { NewSessionPageLayoutView } from "@vetta-org/theme-ui/chat";
import { PANEL_REVEAL_DURATION, PANEL_REVEAL_EASE, PANEL_REVEAL_TRANSITION } from "../command-panel/constants";
import { NewSessionHero } from "./NewSessionHero";
import { GuideBadgeSwiper } from "../GuideBadgeSwiper";
import { NewSessionContextBlock } from "./NewSessionContextBlock";
import type { NewSessionContextBlockModel } from "./useNewSessionContextBlock";
import { NewSessionSetupControls } from "./NewSessionSetupControls";
import type { ProjectOption, ProjectSelection } from "./project-selector/project-selection";
import { DefaultInputBarConnector } from "../input-bar/DefaultInputBarConnector";
import type { SendInteractionContext } from "../input-bar/types";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { TeamComposerConnector } from "../../connectors/team/TeamComposerConnector";
import type { TeamChatActions, TeamChatViewModel } from "../../connectors/team/teamChatModel";
import { isTeamTarget, type NewSessionTargetKey } from "./target";

/** 命令区展开时输入栏下移的距离：面板向上生长，下方留白同步收掉。 */
const PANEL_SHIFT_Y = 120;

interface NewSessionPageViewProps {
	activityPanelCwd: string | null;
	avatarAutoplay: boolean;
	className?: string;
	commandPanelExpanded: boolean;
	commandPanelShift: boolean;
	cwd: string;
	greetingTitle: string;
	/** 选中的智能体/团队身份；null 时 hero 展示问候语。 */
	heroIdentity: NewSessionHeroIdentity | null;
	isShort: boolean;
	mounted: boolean;
	onAbort: () => Promise<void>;
	onCommandPanelExpandedChange: (expanded: boolean) => void;
	onSelectPendingProject: (name: string) => void;
	onSelectProject: (cwd: string | null) => void;
	onSend: (overrideText?: string, context?: SendInteractionContext) => Promise<void>;
	preparingProject: boolean;
	projectOptions: readonly ProjectOption[];
	projectSelection: ProjectSelection;
	projectTakenNames: readonly string[];
	targetKey: NewSessionTargetKey | null;
	onSelectTarget: (targetKey: NewSessionTargetKey | null) => void;
	teamComposer: { readonly model: TeamChatViewModel | null; readonly actions: TeamChatActions | null };
	/** 插件上下文区：由选中的目标或输入框里提到的能力唤起。 */
	contextBlock: NewSessionContextBlockModel;
	subtitle: string;
}

export function NewSessionPageView({
	activityPanelCwd,
	avatarAutoplay,
	className,
	commandPanelExpanded,
	commandPanelShift,
	cwd,
	greetingTitle,
	heroIdentity,
	isShort,
	mounted,
	onAbort,
	onCommandPanelExpandedChange,
	onSelectPendingProject,
	onSelectProject,
	onSend,
	preparingProject,
	projectOptions,
	projectSelection,
	projectTakenNames,
	targetKey,
	onSelectTarget,
	contextBlock,
	teamComposer,
	subtitle,
}: NewSessionPageViewProps): JSX.Element {
	const activeRuntimeIds = useActiveSessionRuntimeIds();
	const ThemedNewSessionBackground = useThemeComponent("chat.newSessionBackground", EmptyNewSessionBackground);
	const { t } = useTranslation("chat");
	const preparingLabel = t("newSession.projectSelector.preparing");
	const reduceMotion = useReducedMotion();
	// hero 淡出、输入栏位移、命令区揭幕三条动画同时跑，共用同一条曲线：各跑各的弹簧时
	// 长度不一致，掉帧时能明显看出它们互相在「追」。
	const shiftTransition = reduceMotion ? { duration: 0 } : PANEL_REVEAL_TRANSITION;
	const heroTransition = reduceMotion
		? { duration: 0 }
		: { duration: PANEL_REVEAL_DURATION * 0.6, ease: PANEL_REVEAL_EASE };
	const sessionOptions = (
		<NewSessionSetupControls
			creatingProject={preparingProject}
			onSelectPendingProject={onSelectPendingProject}
			onSelectProject={onSelectProject}
			options={projectOptions}
			selection={projectSelection}
			takenNames={projectTakenNames}
			targetKey={targetKey}
			onSelectTarget={onSelectTarget}
		/>
	);

	return (
		<div className="flex h-full min-w-0 flex-1">
			<NewSessionPageLayoutView
				isShort={isShort}
				background={null}
				themedBackground={<ThemedNewSessionBackground />}
				dropZone={(children) => (
					<div className={cn("relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background", className)}>
						{children}
					</div>
				)}
				hero={
					// 命令区展开时让出标题区域，避免覆盖上方内容。
					<motion.div
						animate={{ opacity: commandPanelExpanded ? 0 : 1 }}
						transition={heroTransition}
						// 提前建立淡出图层，避免命令区展开时反复重绘标题。
						style={{ willChange: "opacity" }}
						className={cn(
							// 横向 padding 必须与 InputBarView 根节点的 `px-2 sm:px-4` 一致：
							// 两边都是「全宽容器 + 内层 mx-auto max-w-2xl」，窗口宽到放得下 2xl 时
							// 两者自然对齐，窄到内层被压缩时只有这层 padding 决定左缘，缺了就会
							// 出现 hero/选项行比输入框卡片更靠左的错位。
							"relative z-20 flex w-full flex-col items-center px-2 sm:px-4",
							commandPanelExpanded && "pointer-events-none",
						)}
					>
						<NewSessionHero
							avatarAutoplay={avatarAutoplay}
							greetingTitle={greetingTitle}
							identity={heroIdentity}
							mounted={mounted}
							subtitle={subtitle}
						/>
					</motion.div>
				}
				inputBar={
					<motion.div
						className="relative"
						animate={{ y: commandPanelShift ? PANEL_SHIFT_Y : 0 }}
						transition={shiftTransition}
					>
						{/* Drop target is the input card; cwdOverride enables drop before a session exists. */}
						{isTeamTarget(targetKey) ? (
							teamComposer.model && teamComposer.actions ? (
								<TeamComposerConnector
									model={teamComposer.model}
									actions={teamComposer.actions}
									onExpandedChange={onCommandPanelExpandedChange}
								>
									{sessionOptions}
								</TeamComposerConnector>
							) : (
								<div
									role="status"
									aria-busy="true"
									className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-card/80 text-sm text-muted-foreground"
								>
									{sessionOptions}
									<div className="flex min-h-20 items-center justify-center px-4">
										{t("newSession.agentSelector.loading")}
									</div>
								</div>
							)
						) : (
							<DefaultInputBarConnector
								onSend={onSend}
								onAbort={onAbort}
								cwdOverride={cwd}
								onExpandedChange={onCommandPanelExpandedChange}
								sendPending={preparingProject ? { label: preparingLabel } : undefined}
							>
								{sessionOptions}
							</DefaultInputBarConnector>
						)}
						<div className={cn("mx-auto w-full max-w-2xl px-2 sm:px-4", commandPanelExpanded && "invisible")}>
							<GuideBadgeSwiper mounted={mounted} />
						</div>
					</motion.div>
				}
				landing={
					/* 没有贡献上屏时连槽位都不给：空着也占一份下边距，输入栏会跟着挪一下。 */
					contextBlock.contexts.length === 0 ? undefined : (
						/* 插件上下文区走布局的落地槽：它跟着内容长高，留在输入栏那一格里会把
					   输入框整体往上顶。窄屏下的项目选择器仍在输入栏那格，所以它天然排在
					   「选项目」之后，不会把这一步挤到内容底下。
					   命令区展开时整块让位：那是打断式交互。 */
						<div className="px-2 sm:px-4">
							{/* 宽度由当前选中的那个贡献决定，交给上下文区自己算：这一层看不到选中态。 */}
							<NewSessionContextBlock
								contexts={contextBlock.contexts}
								renderContext={contextBlock.renderContext}
								hidden={commandPanelExpanded}
							/>
						</div>
					)
				}
			/>
			{/* 会话尚未创建：选中项目时活动面板按项目根取上下文；「对话」与待创建项目没有
			    可浏览目录，传 null 走空态（conversation 根是所有会话工作区的父目录，不展示）。 */}
			<CurrentScenarioActivityPanel
				workspace={createActivityWorkspace(
					activityPanelCwd ?? "new-session:unbound",
					activityPanelCwd,
					activeRuntimeIds,
				)}
			/>
		</div>
	);
}

function EmptyNewSessionBackground(): null {
	return null;
}
