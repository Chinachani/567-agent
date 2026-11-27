import { MessageCenterTriggerView } from "@vetta-org/theme-ui/sidebar";
import { forwardRef } from "react";
import { useTranslation } from "react-i18next";

export interface MessageCenterTriggerProps {
	open: boolean;
	totalUnread: number;
	onOpen: () => void;
}

export const MessageCenterTrigger = forwardRef<HTMLButtonElement, MessageCenterTriggerProps>(function MessageCenterTrigger(
	{ open, totalUnread, onOpen },
	ref,
): JSX.Element {
	const { t } = useTranslation("message");
	return (
		<MessageCenterTriggerView
			ref={ref}
			open={open}
			totalUnread={totalUnread}
			title={t("triggerTitle")}
			unreadLabel={totalUnread > 0 ? t("unread", { count: totalUnread }) : undefined}
			onOpen={onOpen}
		/>
	);
});
