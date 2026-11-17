import {
	isAutomationModel,
	isAutomationNotification,
	isAutomationRunTarget,
	isAutomationSchedule,
	type ScheduledTask,
} from "../../shared/automation.js";
import type { LegacyScheduledTask } from "./automation-migration.js";
import { isValidCronExpression, isValidSchedule } from "./cron.js";

export function assertAutomationId(value: unknown): asserts value is string {
	if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value))
		throw new Error("Invalid automation record identifier");
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid automation data");
	return value as Record<string, unknown>;
}
function finite(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value);
}
function assertCommon(task: Record<string, unknown>): void {
	assertAutomationId(task.id);
	if (
		typeof task.name !== "string" ||
		!task.name.trim() ||
		typeof task.prompt !== "string" ||
		!task.prompt.trim() ||
		typeof task.enabled !== "boolean" ||
		!finite(task.createdAt) ||
		!finite(task.updatedAt) ||
		(task.lastRunAt !== null && !finite(task.lastRunAt)) ||
		![null, "success", "failed"].includes(task.lastRunStatus as string | null)
	)
		throw new Error("Invalid automation task");
	if (task.executionMode !== undefined && !["inherit", "sandbox", "full-access"].includes(String(task.executionMode)))
		throw new Error("Invalid automation permissions");
	if (task.skill !== undefined) {
		const skill = object(task.skill);
		if (
			!["skill", "scene"].includes(String(skill.type)) ||
			typeof skill.name !== "string" ||
			!skill.name.trim() ||
			(skill.alias !== undefined && typeof skill.alias !== "string")
		)
			throw new Error("Invalid automation skill");
	}
}
export function parseLegacyTasks(value: unknown): LegacyScheduledTask[] {
	if (!Array.isArray(value)) throw new Error("Invalid legacy automation file");
	const ids = new Set<string>();
	return value.map((item) => {
		const task = object(item);
		assertCommon(task);
		assertAutomationId(task.id);
		if (ids.has(task.id)) throw new Error("Duplicate legacy automation identifier");
		ids.add(task.id);
		if (
			typeof task.cron !== "string" ||
			!isValidCronExpression(task.cron) ||
			(task.isOnce !== undefined && typeof task.isOnce !== "boolean") ||
			(task.cwd !== undefined && typeof task.cwd !== "string") ||
			(task.modelKey !== undefined && typeof task.modelKey !== "string")
		)
			throw new Error("Invalid legacy automation schedule");
		return task as unknown as LegacyScheduledTask;
	});
}
export interface AutomationStoreFile {
	readonly schemaVersion: 2;
	readonly tasks: ScheduledTask[];
}
export function parseAutomationStore(value: unknown): AutomationStoreFile {
	if (value === undefined) return { schemaVersion: 2, tasks: [] };
	const store = object(value);
	// version:2 is accepted for files created by upstream; writes use the shared toolkit schemaVersion convention.
	if ((store.schemaVersion ?? store.version) !== 2 || !Array.isArray(store.tasks))
		throw new Error("Unsupported automation store version");
	const ids = new Set<string>();
	for (const item of store.tasks) {
		const task = object(item);
		assertCommon(task);
		assertAutomationId(task.id);
		if (ids.has(task.id)) throw new Error("Duplicate automation identifier");
		ids.add(task.id);
		if (
			!isAutomationSchedule(task.schedule) ||
			!isValidSchedule(task.schedule) ||
			!isAutomationRunTarget(task.runTarget)
		)
			throw new Error("Invalid automation schedule or target");
		if (task.model !== undefined && !isAutomationModel(task.model)) throw new Error("Invalid automation model");
		if (task.notification !== undefined && !isAutomationNotification(task.notification))
			throw new Error("Invalid automation notification");
		if (
			task.suspendedReason !== undefined &&
			!["session-deleted", "project-removed", "skill-retired"].includes(String(task.suspendedReason))
		)
			throw new Error("Invalid automation suspension");
		if (task.skill && object(task.skill).type === "scene" && task.enabled)
			throw new Error("Retired scene cannot run as an automation");
	}
	return { schemaVersion: 2, tasks: store.tasks as ScheduledTask[] };
}
