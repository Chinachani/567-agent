import type { RuntimeHost } from "@567agent/runtime-core";
import { DEFAULT_CONVERSATION_CWD, onDesktopConfigChanged, readDesktopConfig } from "../config/desktop-config-store.js";
import { isConversationCwd } from "../conversations/session-paths.js";
import { getAppLogger } from "../logger.js";
import { sameProjectPath } from "../projects/project-path.js";
import { syncTaskSchedule, unscheduleTaskInCron } from "./scheduler.js";
import { getDesktopSchedulerServiceIfReady, type SchedulerServiceDependencies } from "./scheduler-service.js";
import { setLegacyMigrationContextProvider } from "./task-storage.js";

/** 项目仍在侧边栏（含归档）才算可用；「对话」恒可用。 */
async function isKnownProject(cwd: string): Promise<boolean> {
	if (isConversationCwd(cwd)) return true;
	const config = await readDesktopConfig();
	return [...(config.projects ?? []), ...(config.archivedProjects ?? [])].some((project) =>
		sameProjectPath(project.path, cwd),
	);
}

export function createDesktopSchedulerDependencies(getRuntime: () => RuntimeHost): SchedulerServiceDependencies {
	onDesktopConfigChanged((previous, next) => {
		const retained = [...next.projects, ...next.archivedProjects];
		for (const project of [...previous.projects, ...previous.archivedProjects]) {
			if (retained.some((entry) => sameProjectPath(entry.path, project.path))) continue;
			void getDesktopSchedulerServiceIfReady()
				?.handleProjectRemoved(project.path)
				.catch((error) =>
					getAppLogger("scheduler").error("failed to suspend automations for removed project", error),
				);
		}
	});
	// 旧定时任务迁移时，据项目列表推断会话归属；须在首次读取任务前注入。
	setLegacyMigrationContextProvider(async () => {
		const config = await readDesktopConfig();
		const projects = [...(config.projects ?? []), ...(config.archivedProjects ?? [])];
		return {
			conversationCwd: DEFAULT_CONVERSATION_CWD,
			isKnownProject: (cwd) => projects.some((project) => sameProjectPath(project.path, cwd)),
			now: Date.now(),
		};
	});
	return {
		getRuntime,
		syncTask: syncTaskSchedule,
		unscheduleTask: unscheduleTaskInCron,
		isKnownProject,
		sameProjectPath,
		conversationCwd: DEFAULT_CONVERSATION_CWD,
	};
}
