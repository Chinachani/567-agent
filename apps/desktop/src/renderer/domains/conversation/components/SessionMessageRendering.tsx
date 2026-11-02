import type { ReactNode } from "react";
import { createContext, useContext, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@vetta-org/ui";
import { useSessionMessageForkAction } from "../hooks/useUserMessageActions";
import { AssistantMessage } from "./message-list/AssistantMessage";
import type { MessageItemProps } from "./message-list/MessageItem";
import { MessageRenderingDefaults } from "./message-list/MessageRendering";
import { SessionUserMessage } from "./message-list/SessionUserMessage";
import type { ChatConversationItem } from "./message-list/types";

const ReplyForkEntries = createContext<ReadonlyMap<string, string>>(new Map());

function SessionAssistantMessage(props: MessageItemProps) {
	const entries = useContext(ReplyForkEntries);
	const { t } = useTranslation("chat");
	const fork = useSessionMessageForkAction({
		entryId: entries.get(props.message.id),
		isStreaming: props.isStreaming,
		onAbortEdit: props.onAbortEdit,
	});
	if (props.message.kind !== "agent") return null;
	const finished = ["completed", "failed", "aborted"].includes(props.message.phase);
	return (
		<AssistantMessage
			{...props}
			message={props.message}
			actions={
				!props.exportMode && finished && fork.available ? (
					<Button
						variant="ghost"
						size="icon-sm"
						className="h-6 w-6 text-muted-foreground/45 hover:text-foreground"
						onClick={fork.onFork}
						title={t("messageList.forkButton")}
						aria-label={t("messageList.forkButton")}
					>
						<span className="icon-[solar--branching-paths-up-linear] h-3.5 w-3.5" aria-hidden="true" />
					</Button>
				) : null
			}
		/>
	);
}

const sessionRendering = {
	renderers: {
		user: (props: MessageItemProps) =>
			props.message.kind === "user" ? <SessionUserMessage {...props} message={props.message} /> : null,
		agent: SessionAssistantMessage,
	},
};

/** History commands belong only to ordinary sessions, never to Team/read-only/export feeds. */
export function SessionMessageRendering({
	messages,
	children,
}: {
	messages: readonly ChatConversationItem[];
	children: ReactNode;
}) {
	const previousEntries = useRef<ReadonlyMap<string, string>>(new Map());
	const entries = useMemo(() => {
		const result = new Map<string, string>();
		let userEntryId: string | undefined;
		let replyId: string | undefined;
		for (const message of messages) {
			if (message.kind === "user") {
				userEntryId = message.entryId;
				replyId = undefined;
			} else if (message.kind === "agent" && userEntryId) {
				// A restored bubble can merge many model/tool messages. Fork the entire
				// durable user turn and expose its action only on that turn's last reply.
				if (replyId) result.delete(replyId);
				replyId = message.id;
				result.set(replyId, userEntryId);
			}
		}
		const previous = previousEntries.current;
		// Text deltas do not change fork anchors; keep older reply footers out of the stream's render loop.
		if (previous.size === result.size && [...result].every(([key, value]) => previous.get(key) === value)) {
			return previous;
		}
		previousEntries.current = result;
		return result;
	}, [messages]);
	return (
		<ReplyForkEntries.Provider value={entries}>
			<MessageRenderingDefaults value={sessionRendering}>{children}</MessageRenderingDefaults>
		</ReplyForkEntries.Provider>
	);
}
