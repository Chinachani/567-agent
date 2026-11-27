import { useRef } from "react";
import { MessageCenterDialog } from "./MessageCenterDialog";
import { MessageCenterTrigger } from "./MessageCenterTrigger";
import { useMessageCenterModel } from "./useMessageCenterModel";

export function MessageCenter(): JSX.Element {
	const model = useMessageCenterModel();
	const triggerRef = useRef<HTMLButtonElement>(null);

	return (
		<>
			<MessageCenterTrigger
				ref={triggerRef}
				open={model.open}
				totalUnread={model.totalUnread}
				onOpen={() => model.setOpen(!model.open)}
			/>
			<MessageCenterDialog
				activeTab={model.activeTab}
				chatUnread={model.chatUnread}
				notifUnread={model.notifUnread}
				open={model.open}
				pendingCount={model.pendingCount}
				onClose={model.close}
				onOpenChange={model.setOpen}
				onSelectTab={model.setActiveTab}
				onCloseAutoFocus={(event) => {
					event.preventDefault();
					triggerRef.current?.focus();
				}}
			/>
		</>
	);
}
