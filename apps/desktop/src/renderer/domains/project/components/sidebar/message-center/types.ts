export type MessageCenterTab = "all" | "notifications" | "results" | "claw";

export type MessageCenterTabConfig = {
	value: MessageCenterTab;
	icon: string;
};

export const MESSAGE_CENTER_TABS: MessageCenterTabConfig[] = [
	{ value: "all", icon: "icon-[solar--inbox-linear]" },
	{ value: "results", icon: "icon-[solar--checklist-linear]" },
	{ value: "claw", icon: "icon-[solar--chat-line-linear]" },
	{ value: "notifications", icon: "icon-[solar--bell-linear]" },
];

export const MESSAGE_CENTER_SPRING = { type: "spring" as const, stiffness: 420, damping: 32 };
