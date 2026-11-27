import { useOpenTerminal } from "@domains/bottom-panel/hooks/useOpenTerminal";
import { useBottomPanelToggle } from "@domains/bottom-panel/hooks/useBottomPanelToggle";
import type { WorkSurfaceScope } from "@shared/workspace/work-surface";
import {
	activeSessionPathAtom,
	currentScenarioAtom,
	pageHeaderLeftActionsAtom,
	pageHeaderRightSlotAtom,
	pageHeaderImmersiveAtom,
} from "@shared/store/atoms";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import { useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useBoundAgentParticipants } from "../hooks/useBoundAgentParticipants";
import { useChatViewModel } from "../hooks/useChatViewModel";
import { ChatHeaderActionsView } from "./chat-view/ChatHeaderActionsView";
import { ChatHeaderNewSessionButton } from "./chat-view/ChatHeaderNewSessionButton";
import { ChatComposer, DefaultChatView } from "./chat-view/DefaultChatView";
import type { ChatViewProps } from "./chat-view/types";
import { DefaultInputBarConnector } from "./input-bar/DefaultInputBarConnector";
import { SessionAssistantRendering } from "./SessionAssistantRendering";
import { SessionMessageList } from "./SessionMessageList";
import { SessionOpenFailureNotice } from "./SessionOpenFailureNotice";
import { SessionTaskProgress } from "./SessionTaskProgress";

const SessionFeed = memo(SessionMessageList);

export const DefaultChatComposer = memo(function DefaultChatComposer({
	onSend,
	onAbort,
	onSendQueued,
	cwdOverride,
	workSurface,
}: ChatViewProps & { workSurface?: WorkSurfaceScope | null }): JSX.Element {
	return (
		<ChatComposer>
			<SessionOpenFailureNotice />
			<DefaultInputBarConnector
				onSend={onSend}
				onAbort={onAbort}
				onSendQueued={onSendQueued}
				cwdOverride={cwdOverride}
				workSurface={workSurface}
			/>
		</ChatComposer>
	);
});

export function ChatView(props: ChatViewProps): JSX.Element {
	const { actions, model } = useChatViewModel();
	const participants = useBoundAgentParticipants();
	const scenario = useAtomValue(currentScenarioAtom) ?? undefined;
	const sessionPath = useAtomValue(activeSessionPathAtom);
	const workSurface = useMemo<WorkSurfaceScope | null>(
		() => (model.sessionId ? { key: model.sessionId, cwd: model.cwd, scenario } : null),
		[model.sessionId, model.cwd, scenario],
	);
	const terminal = useOpenTerminal(workSurface);
	const bottomPanel = useBottomPanelToggle(workSurface);
	const runtimeIds = useActiveSessionRuntimeIds();
	const setHeaderRightSlot = useSetAtom(pageHeaderRightSlotAtom);
	const setHeaderImmersive = useSetAtom(pageHeaderImmersiveAtom);
	const setHeaderLeftSlot = useSetAtom(pageHeaderLeftActionsAtom);
	const headerActions = useMemo(
		() => (
			<ChatHeaderActionsView
				actions={actions}
				model={model.header}
				sessionId={sessionPath}
				terminal={terminal}
				bottomPanel={workSurface ? bottomPanel : undefined}
			/>
		),
		[actions, model.header, sessionPath, terminal, bottomPanel, workSurface],
	);
	const workspace = useMemo(
		() => createActivityWorkspace(model.cwd ?? model.sessionId ?? "conversation:unbound", model.cwd, runtimeIds),
		[model.cwd, model.sessionId, runtimeIds],
	);
	const onAbort = useCallback(() => {
		void props.onAbort();
	}, [props.onAbort]);

	useEffect(() => {
		setHeaderRightSlot(headerActions);
		return () => setHeaderRightSlot(null);
	}, [headerActions, setHeaderRightSlot]);

	useEffect(() => {
		setHeaderLeftSlot(<ChatHeaderNewSessionButton />);
		return () => setHeaderLeftSlot(null);
	}, [setHeaderLeftSlot]);

	useEffect(() => {
		setHeaderImmersive(true);
		return () => setHeaderImmersive(false);
	}, [setHeaderImmersive]);

	return (
		<DefaultChatView
			messages={model.messages}
			workspace={workspace}
			workSurface={workSurface}
			rootClassName={model.rootClassName}
			exportState={model.exporting ? { title: model.exportTitle, onFinished: actions.finishExport } : undefined}
		>
			<SessionAssistantRendering>
				<SessionFeed
					messages={model.messages}
					workspace={workspace}
					isStreaming={model.isStreaming}
					sessionId={model.sessionId}
					participants={participants}
					onSend={props.onSend}
					onAbort={onAbort}
				/>
			</SessionAssistantRendering>
			<SessionTaskProgress />
			<DefaultChatComposer {...props} workSurface={workSurface} />
		</DefaultChatView>
	);
}
