export const VISIBLE_CONVERSATION_CHANNEL = "agent567:session:visible-conversation";

export interface DesktopVisibleConversation {
	readonly id: string;
	readonly title: string;
	readonly status: "idle" | "running" | "waiting" | "failed" | "interrupted";
}
export interface DesktopDeviceStatusSnapshot {
	readonly activeConversation: DesktopVisibleConversation | null;
}
