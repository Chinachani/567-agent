import { ContextWorkspace } from "../ContextWorkspace";
import { PerfSendProfiler } from "@shared/lib/perf-send";
import { useThemeComponent } from "@vetta-org/theme-sdk";
import { useThemeSurface } from "@vetta-org/theme-sdk/appearance";
import { MessageInput, InputBarContextMenuView, InputBarPlaceholder } from "@vetta-org/theme-ui/chat";
import { useDelayedUnmount } from "@vetta-org/theme-ui/shared";
import { motion } from "motion/react";
import { createPortal } from "react-dom";
import { ActionButtonBar } from "../ActionButtonBar";
import { AtPanel } from "../AtPanel";
import { CommandPanel } from "../command-panel/CommandPanel";
import { McpElicitationPanel } from "../McpElicitationPanel";
import { PlanReviewPanel } from "../PlanReviewPanel";
import { QuestionPanel } from "../QuestionPanel";
import { InputBarBackground } from "./InputBarBackground";
import { InputBarAttachmentPreview } from "./InputBarAttachmentPreview";
import { InputBarDrawer } from "./InputBarDrawer";
import { InputBarFooter } from "./InputBarFooter";
import { InputBarSpeechStatus } from "./InputBarSpeechStatus";
import { InputBarTodoStatus } from "./InputBarTodoStatus";
import { InputBarMention } from "./InputBarMention";
import {
	InputBarActiveActions,
	InputBarAttachmentActions,
	InputBarContextAction,
	InputBarExecutionModeAction,
	InputBarModelAction,
	InputBarSendAction,
	InputBarSkillsAction,
	InputBarSpeechAction,
	InputBarToolbarDivider,
} from "./InputBarToolbar";
import { InputEditor } from "./editor/InputEditor";
import { PromptAttachmentLabels } from "./PromptAttachmentLabels";
import type { InputBarViewProps } from "./types";

const SOFT = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };

export function InputBarView({ model, children, className, classNames }: InputBarViewProps): JSX.Element {
	const hasPendingInteraction = Boolean(
		model.pendingMcpElicitation || model.pendingQuestion || model.pendingPlanReview,
	);
	const commands = model.commands;
	const slashOpen = commands?.slashOpen ?? false;
	const slashVisible = commands?.slashVisible ?? false;
	const surface = useThemeSurface("chat.inputBar");
	const ThemedInputBarBackground = useThemeComponent("chat.inputBarBackground", InputBarBackground);
	const ThemedInputBarPlaceholder = useThemeComponent("chat.inputBarPlaceholder", InputBarPlaceholder);
	// 附件胶囊区折叠动画播完（200ms）后再卸载内容，动画本身是纯 CSS grid 过渡。
	const renderCapsules = useDelayedUnmount(model.hasCapsules, 220);

	const contextTools = (
		<div
			data-message-input-part="context-toolbar"
			className={
				model.contextToolsPlacement === "bottom"
					? "flex min-w-0 flex-wrap items-center gap-1"
					: "flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/50 px-3 py-2"
			}
		>
			<InputBarModelAction
				visible={!slashOpen}
				updateActiveSession={model.modelSelector.updateActiveSession}
				scope={model.modelSelector.scope}
			/>
			<div className="ml-auto flex min-w-0 items-center gap-1">
				{model.trailingTools.map((tool) =>
					tool.kind === "workbench" ? (
						<ContextWorkspace key={tool.kind} sessionId={tool.sessionId} sessionKey={tool.sessionKey} />
					) : model.contextToolsPlacement === "bottom" &&
						tool.model.percent === 0 &&
						!tool.model.isCompacting ? null : (
						<InputBarContextAction key={tool.kind} visible={!slashOpen} model={tool.model} render={tool.render} />
					),
				)}
			</div>
		</div>
	);

	return (
		<div
			className={["relative px-2 pb-3 pt-1 sm:px-4 sm:pb-4", className, classNames?.root].filter(Boolean).join(" ")}
		>
			{model.pendingMcpElicitation ? (
				<motion.div
					key="mcp-elicitation"
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={SOFT}
					className="relative mx-auto w-full max-w-2xl"
				>
					<McpElicitationPanel request={model.pendingMcpElicitation} />
				</motion.div>
			) : model.pendingQuestion ? (
				<motion.div
					key="ask-user-question"
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={SOFT}
					className="relative w-full"
				>
					<QuestionPanel pending={model.pendingQuestion} className="!px-0 !pb-0 !pt-0" />
				</motion.div>
			) : model.pendingPlanReview ? (
				<motion.div
					key="plan-review"
					initial={{ opacity: 0, y: 12 }}
					animate={{ opacity: 1, y: 0 }}
					transition={SOFT}
					className="relative w-full"
				>
					<PlanReviewPanel pending={model.pendingPlanReview} className="!px-0 !pb-0 !pt-0" />
				</motion.div>
			) : null}

			<div
				className={[
					// @container：工具栏/动作条按输入区宽度折叠文案（非视口），避免窄栏换行
					"relative mx-auto w-full max-w-2xl @container",
					classNames?.stack,
				]
					.filter(Boolean)
					.join(" ")}
				aria-hidden={hasPendingInteraction ? true : undefined}
				inert={hasPendingInteraction ? true : undefined}
				// Keep Lexical and its draft/history mounted while the interaction owns layout height.
				style={hasPendingInteraction ? { display: "none" } : undefined}
			>
				{commands ? (
					<PerfSendProfiler id="ib:AtPanel">
						<AtPanel
							open={!hasPendingInteraction && commands.atOpen}
							onClose={commands.onAtClose}
							onSelect={commands.onAtSelect}
							filter={commands.atFilter}
							cwd={model.effectiveCwd}
							items={commands.atItems}
						/>
					</PerfSendProfiler>
				) : null}
				{commands ? (
					<PerfSendProfiler id="ib:ActionButtonBar">
						<ActionButtonBar />
					</PerfSendProfiler>
				) : null}
				<InputBarDrawer
					items={model.drawerItems}
					activeTabId={model.drawerActiveTab}
					onActiveTabChange={model.actions.setDrawerActiveTab}
					permissionLabels={model.labels.permission}
				/>

				<MessageInput.Root focused={model.isFocused} topConnected={slashVisible}>
					<MessageInput.Surface
						asChild
						className={[surface?.rootClassName, classNames?.card].filter(Boolean).join(" ")}
					>
						<MessageInput.DropZone
							{...model.dropZone}
							style={{
								opacity: model.hasSession ? 1 : 0.55,
								...(slashVisible ? { borderTopColor: "transparent" } : null),
							}}
						>
							<ThemedInputBarBackground />
							<MessageInput.Content className={classNames?.cardContent}>
								{children}
								{model.contextToolsPlacement !== "bottom" ? contextTools : null}
								{commands ? (
									<PerfSendProfiler id="ib:CommandPanel">
										<CommandPanel
											open={!hasPendingInteraction && commands.slashOpen}
											onClose={commands.onSlashClose}
											onSelect={commands.onSlashSelect}
											onSelectConnector={commands.onConnectorSelect}
											filter={commands.slashFilter}
											cwd={model.effectiveCwd || undefined}
											className={model.isFocused ? "border-primary/20" : undefined}
											allowCompaction={commands.allowCompaction}
										/>
									</PerfSendProfiler>
								) : null}

								{/*
								 * 顶部附件区只剩「不是一个词」的东西：重编辑提示、Appshot 复合卡片、
								 * 插件上下文、场景胶囊。文件 / 图片 / skill 都已进入文本流。
								 */}
								<InputBarAttachmentPreview
									open={model.hasCapsules}
									renderContent={renderCapsules}
									className={classNames?.capsules}
									pendingMessageEdit={model.pendingMessageEdit}
									pendingEditHint={model.pendingEditHint}
									cancelPendingEditLabel={model.cancelPendingEditLabel}
									appshotAttachment={model.appshotAttachment}
									images={model.imageAttachments}
									removeImageLabel={model.labels.capsule.removeImage}
									onCancelPendingEdit={model.actions.cancelPendingEdit}
									onRemoveAppshot={model.actions.removeAppshot}
									onOpenImagePreview={model.actions.openImagePreview}
									onRemoveImage={model.actions.removeImage}
								/>

								<div className={["px-4 pb-1 pt-3", classNames?.editorWrap].filter(Boolean).join(" ")}>
									<div
										className="relative"
										onKeyDownCapture={(event) => {
											// 先于编辑器拿到按键：被连接层认领的组合键不再进入 Lexical。
											if (model.actions.handleKeyDown?.(event.nativeEvent)) event.stopPropagation();
										}}
									>
										<PerfSendProfiler id="ib:InputEditor">
											<InputEditor
												ariaLabel={model.placeholderTexts[0]}
												editable={model.hasSession}
												namespace={model.editor.namespace}
												value={model.editor.value}
												segments={model.editor.segments}
												history={model.editor.history}
												onValueChange={model.editor.onValueChange}
												persistenceId={model.editor.persistenceId}
												onContextMenu={model.actions.handleContextMenu}
												onEnter={model.actions.handleEnter}
												onFocusChange={model.actions.setFocused}
												onTriggerChange={commands?.onTriggerChange}
											/>
										</PerfSendProfiler>
										<ThemedInputBarPlaceholder
											texts={model.placeholderTexts}
											visible={model.showPlaceholder}
											rotating={model.placeholderRotating}
										/>
									</div>
								</div>

								<PerfSendProfiler id="ib:Toolbar">
									<MessageInput.Toolbar className={classNames?.toolbar}>
										<MessageInput.ToolbarLeading
											className={model.contextToolsPlacement === "bottom" ? "flex-wrap gap-y-1" : undefined}
										>
											{model.contextToolsPlacement === "bottom" ? contextTools : null}
											{/*
											 * 标记给命令区的 click-outside 判定用：否则 mousedown 先收起、
											 * 随后的 click 又打开，按钮无法关闭面板。
											 */}
											{commands ? (
												<InputBarSkillsAction
													active={commands.slashOpen}
													disabled={!model.hasSession}
													title={model.labels.toolbar.skills}
													onSelect={commands.onOpen}
												/>
											) : null}
											{model.routing ? (
												<InputBarMention
													model={model.routing}
													disabled={!model.hasSession}
													visible={!slashOpen}
												/>
											) : null}
											{commands ? <InputBarToolbarDivider /> : null}
											{/* 两组控件保持挂载、只切 display，避免展开动画首帧重建复杂 selector。 */}
											<InputBarAttachmentActions
												disabled={!model.hasSession}
												visible={!commands || commands.slashOpen}
												addImageTitle={model.labels.toolbar.addImage}
												attachFileTitle={model.labels.toolbar.attachFile}
												onSelectFiles={() => void model.actions.handleSelectFiles()}
												onSelectImages={() => void model.actions.handleSelectImages()}
											/>
											{model.leadingTools.map((tool) => (
												<InputBarExecutionModeAction
													key={tool.kind}
													visible={!slashOpen}
													model={tool.model}
												/>
											))}
											<InputBarActiveActions
												items={model.activeActions}
												removeHint={model.labels.capsule.removeDefault}
												groupLabel={model.labels.capsule.activeGroup}
											/>
										</MessageInput.ToolbarLeading>
										<MessageInput.ToolbarTrailing>
											{slashOpen ? null : <InputBarSpeechAction input={model.speechInput} />}
											<InputBarSendAction
												canSend={model.canSend}
												canQueue={model.sendBehavior === "queueable"}
												isEmpty={model.isEmpty}
												isStreaming={model.isStreaming}
												queueTitle={model.labels.toolbar.queue}
												pending={model.sendPending}
												onAbort={model.actions.handleAbort}
												onSend={model.actions.handleSend}
											/>
										</MessageInput.ToolbarTrailing>
									</MessageInput.Toolbar>
								</PerfSendProfiler>
							</MessageInput.Content>
						</MessageInput.DropZone>
					</MessageInput.Surface>
				</MessageInput.Root>

				{/*
				 * 卡片下沿的附属区：出现时整条输入栏被平滑抬高，消失时落回去，动画由
				 * InputBarFooter 用 CSS 过渡承担。待办只是第一个住户，后续元素加进 items 即可。
				 */}
				<InputBarFooter.Root>
					<InputBarFooter.Item>
						{/* 插件引用排在下沿最上面：它离卡片最近，跟「这一条要发什么」关系最紧。 */}
						{model.promptAttachmentLabels?.length ? (
							<PromptAttachmentLabels
								labels={model.promptAttachmentLabels}
								icon={model.promptAttachmentIcon}
								iconUrl={model.promptAttachmentIconUrl}
								removeLabel={model.labels.capsule.removeDefault}
								onRemove={model.actions.removePromptAttachment}
							/>
						) : null}
					</InputBarFooter.Item>
					<InputBarFooter.Item>{model.todo ? <InputBarTodoStatus todo={model.todo} /> : null}</InputBarFooter.Item>
					<InputBarFooter.Item>
						{model.speechInput?.statusText ? <InputBarSpeechStatus text={model.speechInput.statusText} /> : null}
					</InputBarFooter.Item>
				</InputBarFooter.Root>
			</div>

			{model.contextMenu ? createPortal(<InputBarContextMenuView {...model.contextMenu} />, document.body) : null}
		</div>
	);
}
