import type { OpenTerminalEntry } from "@domains/bottom-panel/hooks/useOpenTerminal";
import type { BottomPanelToggle } from "@domains/bottom-panel/hooks/useBottomPanelToggle";
import { ConversationHeaderActions } from "@domains/header-actions/ConversationHeaderActions";
import { ChatHeaderActions, type HeaderActionBarItem } from "@vetta-org/theme-ui/chat";
import { ExpertHandoffDialog } from "./ExpertHandoffDialog";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackgroundTasksBadge } from "../BackgroundTasksBadge";
import { SandboxGrantsBadge } from "../SandboxGrantsBadge";
import type { ChatViewActions, ChatViewHeaderModel } from "./types";

interface ChatHeaderActionsViewProps {
	actions: ChatViewActions;
	model: ChatViewHeaderModel;
	terminal?: OpenTerminalEntry;
	bottomPanel?: BottomPanelToggle;
}

export function ChatHeaderActionsView({
	actions,
	model,
	terminal,
	bottomPanel,
}: ChatHeaderActionsViewProps): JSX.Element {
	const { t } = useTranslation("chat");
	const { t: expertT } = useTranslation("agent-teams");
	const [handoff, setHandoff] = useState(false);
	const builtins = useMemo(() => {
		const items: HeaderActionBarItem[] = [];
		if (terminal?.available)
			items.push({
				key: "builtin:terminal",
				title: t("bottomPanel.openTerminal"),
				icon: <span className="icon-[solar--code-square-linear] size-4" />,
				active: terminal.focused,
				behavior: { type: "click", onClick: terminal.open },
			});
		if (bottomPanel)
			items.push({
				key: "builtin:bottom-panel",
				title: t("bottomPanel.title"),
				icon: <span className="icon-[solar--window-frame-linear] size-4" />,
				active: bottomPanel.open,
				behavior: { type: "click", onClick: bottomPanel.toggle },
			});
		items.push({
			key: "builtin:export",
			title: model.exportTitle,
			icon: <span className="icon-[solar--export-linear] size-4" />,
			disabled: model.exportDisabled || model.exporting,
			behavior: { type: "click", onClick: actions.openExport },
		});
		items.push({
			key: "builtin:pin",
			title: model.pinTitle,
			icon: <span className="icon-[solar--pin-linear] size-4" />,
			active: model.pinned,
			promoteWhenActive: true,
			retainWhenNarrow: true,
			behavior: { type: "click", onClick: actions.togglePin },
		});
		items.push({
			key: "builtin:expert-handoff",
			title: expertT("experts.handoff.title"),
			icon: <span className="icon-[solar--users-group-rounded-linear] size-4" />,
			behavior: { type: "click", onClick: () => setHandoff(true) },
		});
		return items;
	}, [actions, model, terminal, bottomPanel, t, expertT]);
	return (
		<>
			{handoff && <ExpertHandoffDialog onClose={() => setHandoff(false)} />}
			<BackgroundTasksBadge />
			<SandboxGrantsBadge />
			<ConversationHeaderActions
				builtins={builtins}
				pinned={
					<ChatHeaderActions.Panel
						label={model.panelLabel}
						title={model.panelTitle}
						open={model.panelOpen}
						onClick={actions.togglePanel}
					/>
				}
			/>
		</>
	);
}
