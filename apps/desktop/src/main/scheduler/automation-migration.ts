import type { AutomationMonthDay, AutomationSchedule, ScheduledTask } from "../../shared/automation.js";
import { nextFireTime } from "./cron.js";

/** 重新设计前（ADR-0127 之前）写入 scheduled-tasks.json 的任务形状。 */
export interface LegacyScheduledTask {
	id: string;
	name: string;
	prompt: string;
	cron: string;
	isOnce?: boolean;
	enabled: boolean;
	cwd?: string;
	modelKey?: string;
	executionMode?: string;
	skill?: { name: string; alias?: string; type: "skill" | "scene" };
	createdAt: number;
	updatedAt: number;
	lastRunAt: number | null;
	lastRunStatus: "success" | "failed" | null;
}

export interface LegacyMigrationContext {
	readonly conversationCwd: string;
	readonly isKnownProject: (cwd: string) => boolean;
	readonly now: number;
}

const FIELD = String.raw`(\d{1,2})`;
const LIST = String.raw`(\d{1,2}(?:,\d{1,2})*)`;

/** 旧 cron 能对上新档位就还原成档位，对不上的归入「自定义」。 */
export function legacyCronToSchedule(cron: string, isOnce: boolean, now: number): AutomationSchedule {
	const expression = cron.trim().replace(/\s+/g, " ");
	if (isOnce) {
		const once = new RegExp(`^${FIELD} ${FIELD} ${FIELD} ${FIELD} \\*$`).exec(expression);
		if (once) {
			const [, minute, hour, day, month] = once.map(Number);
			// 旧的一次性 cron 不带年份，会逐年重复匹配；取下一次匹配时刻，
			// 已停用的任务取今年的那一刻，保持历史语义不漂移。
			const next = nextFireTime({ kind: "custom", cron: expression }, now);
			const thisYear = new Date(new Date(now).getFullYear(), month - 1, day, hour, minute).getTime();
			return { kind: "once", at: next ?? thisYear };
		}
	}
	const hourly = new RegExp(`^${FIELD} \\* \\* \\* \\*$`).exec(expression);
	if (hourly) return { kind: "hourly", minute: Number(hourly[1]) };
	const daily = new RegExp(`^${FIELD} ${FIELD} \\* \\* \\*$`).exec(expression);
	if (daily) return { kind: "daily", hour: Number(daily[2]), minute: Number(daily[1]) };
	const weekly = new RegExp(`^${FIELD} ${FIELD} \\* \\* ${LIST}$`).exec(expression);
	if (weekly) {
		const weekdays = [...new Set(weekly[3].split(",").map((day) => Number(day) % 7))];
		return { kind: "weekly", weekdays, hour: Number(weekly[2]), minute: Number(weekly[1]) };
	}
	const monthly = new RegExp(`^${FIELD} ${FIELD} ${LIST} \\* \\*$`).exec(expression);
	if (monthly) {
		const days: AutomationMonthDay[] = [...new Set(monthly[3].split(",").map(Number))];
		return { kind: "monthly", days, hour: Number(monthly[2]), minute: Number(monthly[1]) };
	}
	return { kind: "custom", cron: expression };
}

/** Preserve the execution directory, explicit permissions and structured skill selection. */
export function migrateLegacyTask(legacy: LegacyScheduledTask, context: LegacyMigrationContext): ScheduledTask {
	const projectCwd = legacy.cwd || context.conversationCwd;
	const known = projectCwd === context.conversationCwd || context.isKnownProject(projectCwd);
	const schedule = legacy.isOnce
		? { kind: "once" as const, at: nextFireTime({ kind: "custom", cron: legacy.cron }, context.now) ?? context.now }
		: legacyCronToSchedule(legacy.cron, false, context.now);
	return {
		id: legacy.id,
		name: legacy.name,
		prompt: legacy.prompt,
		schedule,
		runTarget: { mode: "new-session", projectCwd },
		...(legacy.modelKey ? { model: { key: legacy.modelKey } } : {}),
		executionMode:
			legacy.executionMode === "sandbox" || legacy.executionMode === "full-access"
				? legacy.executionMode
				: "inherit",
		...(legacy.skill ? { skill: legacy.skill } : {}),
		enabled:
			legacy.enabled &&
			known &&
			legacy.skill?.type !== "scene" &&
			(schedule.kind !== "once" || schedule.at > context.now),
		...(!known
			? { suspendedReason: "project-removed" as const }
			: legacy.skill?.type === "scene"
				? { suspendedReason: "skill-retired" as const }
				: {}),
		createdAt: legacy.createdAt,
		updatedAt: legacy.updatedAt,
		lastRunAt: legacy.lastRunAt,
		lastRunStatus: legacy.lastRunStatus,
	};
}
