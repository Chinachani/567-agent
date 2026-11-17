import { ResultInboxList } from "./ResultInboxList";
import { AnimatePresence, motion } from "motion/react";
import { NotificationMessageList } from "./NotificationMessageList";
import type { MessageCenterTab } from "./types";

export function MessageCenterContent({
	activeTab,
	notifUnread,
	onClose,
}: {
	activeTab: MessageCenterTab;
	notifUnread: number;
	onClose: () => void;
}): JSX.Element {
	return (
		<div className="min-h-[160px] flex-1 overflow-y-auto border-t border-border/50">
			<AnimatePresence mode="wait" initial={false}>
				<motion.div
					key={activeTab}
					initial={{ opacity: 0, y: 6 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -6 }}
					transition={{ duration: 0.15 }}
				>
					{(activeTab === "all" || activeTab === "results") && <ResultInboxList onOpen={onClose} />}
					{activeTab === "all" && <>{notifUnread > 0 && <NotificationMessageList />}</>}
					{activeTab === "notifications" && <NotificationMessageList />}
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
