export const COLLABORATION_TOOL_NAMES = {
	list: "project_collaboration_list",
	configure: "project_collaboration_configure",
	control: "project_collaboration_control",
	dispatch: "project_collaboration_dispatch",
	message: "project_collaboration_message",
	history: "project_collaboration_read_history",
	task: "project_collaboration_read_task",
	wait: "project_collaboration_wait",
} as const;
export const collaborationToolNames: ReadonlySet<string> = new Set(Object.values(COLLABORATION_TOOL_NAMES));
