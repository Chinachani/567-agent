import { ipcMain, type WebContents } from "electron";
import { VISIBLE_CONVERSATION_CHANNEL } from "../../shared/visible-conversation.js";
import { onConversationListChanged } from "../conversations/conversation-list-events.js";
import { visibleConversation } from "../conversations/visible-conversation.js";
import { assertTrustedMainRenderer } from "./trusted-renderer.js";

export function registerVisibleConversationIpc(owner: WebContents): () => void {
	const unsubscribe = onConversationListChanged(() => {
		void visibleConversation.refresh().catch(() => {});
	});
	ipcMain.handle(VISIBLE_CONVERSATION_CHANNEL, (event, runtimeId: unknown) => {
		assertTrustedMainRenderer(event, owner);
		if (runtimeId !== null && (typeof runtimeId !== "string" || runtimeId.length < 1 || runtimeId.length > 256))
			throw new Error("Invalid conversation identity");
		return visibleConversation.select(runtimeId);
	});
	return () => {
		unsubscribe();
		ipcMain.removeHandler(VISIBLE_CONVERSATION_CHANNEL);
		void visibleConversation.select(null);
	};
}
