import { CurrentScenarioActivityPanel } from "@domains/activity-panel/components/ActivityPanel";
import { ProjectDetailPageView } from "@vetta-org/theme-ui/project";
import { motion } from "motion/react";
import { BatchQueueStatus } from "./BatchQueueStatus";
import { useProjectDetailPageModel } from "../hooks/useProjectDetailPageModel";
import { useActiveSessionRuntimeIds } from "@shared/workspace/active-session-runtime";
import { createActivityWorkspace } from "@shared/workspace/activity-workspace";

const easeOut = [0.22, 1, 0.36, 1] as const;

export function ProjectDetailPage(): JSX.Element {
	const model = useProjectDetailPageModel();
	const activeRuntimeIds = useActiveSessionRuntimeIds();

	const batchSection =
		model.isBatch && model.batchProject ? (
			<motion.div
				className="px-4 pb-4 @md:px-8"
				initial={{ opacity: 0, y: 10 }}
				animate={{ opacity: 1, y: 0 }}
				transition={{ duration: 0.5, delay: 0.2, ease: easeOut }}
			>
				<BatchQueueStatus project={model.batchProject} />
			</motion.div>
		) : null;

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
			{batchSection && <div className="max-h-[40%] shrink-0 overflow-y-auto">{batchSection}</div>}
			<div className="flex min-h-0 min-w-0 flex-1">
				<ProjectDetailPageView
					activityOpen={model.activityOpen}
					activeSection={model.activeSection}
					collaboration={model.collaboration}
					content={model.content}
					createdAtLabel={model.createdAtLabel}
					cwd={model.cwd}
					displayName={model.displayName}
					editorFocused={model.editorFocused}
					exportable={model.exportable}
					isDirty={model.isDirty}
					labels={model.labels}
					loading={model.loading}
					onContentChange={model.onContentChange}
					onEditorBlur={model.onEditorBlur}
					onEditorFocus={model.onEditorFocus}
					onExport={model.onExport}
					onNewSession={model.onNewSession}
					onSave={model.onSave}
					onShowInFolder={model.onShowInFolder}
					onToggleActivity={model.onToggleActivity}
					onSectionChange={model.onSectionChange}
					projectTypeLabel={model.projectTypeLabel}
					saveStatus={model.saveStatus}
					sessionCountLabel={model.sessionCountLabel}
					taskCountLabel={model.taskCountLabel}
					textareaRef={model.textareaRef}
				/>
				<CurrentScenarioActivityPanel
					workspace={createActivityWorkspace(model.decodedCwd, model.decodedCwd, activeRuntimeIds)}
				/>
			</div>
		</div>
	);
}
