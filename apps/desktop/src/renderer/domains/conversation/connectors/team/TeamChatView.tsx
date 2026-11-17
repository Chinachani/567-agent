import { DefaultChatView, ChatComposer } from "../../components/chat-view/DefaultChatView";
import { MessageList } from "../../components/MessageList";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";
import type { ActivityWorkspace } from "@shared/workspace/activity-workspace";
import { memo, useMemo } from "react";
import { Button } from "@vetta-org/ui";
import { TeamMemberRoster } from "./TeamMemberRoster";
import type { TeamChatActions, TeamChatViewModel } from "./teamChatModel";

export interface TeamChatViewProps {
	readonly model: TeamChatViewModel;
	readonly actions: TeamChatActions;
	readonly onOpenMember: (memberId: string) => void;
	readonly onBackToTeam: () => void;
	readonly onOpenSettings: () => void;
	readonly archiveLabel: string;
	readonly collaborationLabel: string;
	readonly onCollaboration: () => void;
	readonly stopLabel: string;
	readonly emptyHistoryLabel: string;
}

const TeamTimelinePane = memo(function TeamTimelinePane({
	messages,
	workspace,
	isStreaming,
	feedKey,
	members,
	pendingLabel,
	onOpenMember,
}: {
	readonly messages: TeamChatViewModel["feedItems"];
	readonly workspace: ActivityWorkspace;
	readonly isStreaming: boolean;
	readonly feedKey: string;
	readonly members: TeamChatViewModel["members"];
	readonly pendingLabel?: string;
	readonly onOpenMember: (memberId: string) => void;
}): JSX.Element {
	return (
		<MessageList
			messages={messages}
			workspace={workspace}
			isStreaming={isStreaming}
			sessionId={feedKey}
			participants={members}
			pendingLabel={pendingLabel}
			onTeamMemberOpen={onOpenMember}
		/>
	);
});

const TeamRoster = memo(
	function TeamRoster({
		model,
		onOpenMember,
		onBackToTeam,
		onOpenSettings,
	}: Pick<TeamChatViewProps, "model" | "onOpenMember" | "onBackToTeam" | "onOpenSettings">): JSX.Element {
		return (
			<TeamMemberRoster
				members={model.members}
				leaderMemberId={model.leaderMemberId}
				leaderLabel={model.labels.leaderRoute}
				memberRuntimeIds={model.memberRuntimeIds}
				activeMemberId={model.memberViewId}
				onOpenMember={onOpenMember}
				onBackToTeam={onBackToTeam}
				onOpenSettings={onOpenSettings}
			/>
		);
	},
	(previous, next) =>
		previous.model.members === next.model.members &&
		previous.model.leaderMemberId === next.model.leaderMemberId &&
		previous.model.labels.leaderRoute === next.model.labels.leaderRoute &&
		previous.model.memberRuntimeIds === next.model.memberRuntimeIds &&
		previous.model.memberViewId === next.model.memberViewId &&
		previous.onOpenMember === next.onOpenMember &&
		previous.onBackToTeam === next.onBackToTeam &&
		previous.onOpenSettings === next.onOpenSettings,
);

export function TeamChatView({
	model,
	actions,
	onOpenMember,
	onBackToTeam,
	onOpenSettings,
	archiveLabel,
	collaborationLabel,
	onCollaboration,
	stopLabel,
	emptyHistoryLabel,
}: TeamChatViewProps): JSX.Element {
	const workspace = useMemo(
		() => model.workspace ?? createActivityWorkspace(`agent-team:${model.feedKey}`, null),
		[model.feedKey, model.workspace],
	);
	const activity = useMemo(() => ({ pluginScenario: model.pluginScenario }), [model.pluginScenario]);
	const isStreaming = model.memberViewId
		? model.feedItems.some((item) => item.kind === "agent" && item.phase === "streaming")
		: model.status === "sending" || model.status === "streaming" || model.status === "cancelling";

	return (
		<DefaultChatView
			messages={model.feedItems}
			workspace={workspace}
			activity={activity}
			subHeader={
				<TeamRoster
					model={model}
					onOpenMember={onOpenMember}
					onBackToTeam={onBackToTeam}
					onOpenSettings={onOpenSettings}
				/>
			}
		>
			{model.status === "ready" && !model.activeSessionId && model.feedItems.length === 0 && (
				<p role="status" className="p-6 text-sm text-muted-foreground">
					{emptyHistoryLabel}
				</p>
			)}
			<TeamTimelinePane
				messages={model.feedItems}
				workspace={workspace}
				isStreaming={isStreaming}
				feedKey={model.feedKey}
				members={model.members}
				pendingLabel={model.pendingLabel}
				onOpenMember={onOpenMember}
			/>
			<ChatComposer>
				<div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
					<p className="min-w-0 flex-1 text-sm text-muted-foreground">{archiveLabel}</p>
					{isStreaming && stopLabel && (
						<Button variant="outline" onClick={() => void actions.abort()}>
							{stopLabel}
						</Button>
					)}
					{onCollaboration && (
						<Button variant="outline" onClick={onCollaboration}>
							{collaborationLabel}
						</Button>
					)}
				</div>
			</ChatComposer>
		</DefaultChatView>
	);
}
