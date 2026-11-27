import { activeSessionAtom } from "@shared/store/atoms";
import { useAtomValue } from "jotai";
import { ActivityPanelContextProvider } from "@domains/activity-panel/registry/context";
import { BackgroundTasksTabPanel } from "@domains/activity-panel/components/BackgroundTasksTabPanel";
import type { BottomPanelBuiltin } from "./types";

function BackgroundTasksBottomPanel(): JSX.Element {
	const session = useAtomValue(activeSessionAtom);
	return (
		<ActivityPanelContextProvider
			value={{
				workspace: { id: "bottom-panel-background-tasks", cwd: session?.cwd ?? null, runtimeIds: session?.runtimeId ? [session.runtimeId] : [] },
				knowledgeHistory: false,
			}}
		>
			<BackgroundTasksTabPanel />
		</ActivityPanelContextProvider>
	);
}

export const backgroundTasksPanelBuiltin: BottomPanelBuiltin = {
	id: "background-tasks",
	order: 10,
	icon: "icon-[mdi--console-line]",
	labelKey: "bottomPanel.backgroundTasks.title",
	component: BackgroundTasksBottomPanel,
};
