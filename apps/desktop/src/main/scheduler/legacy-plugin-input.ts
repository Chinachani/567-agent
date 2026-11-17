import { automationScheduleToCron, type ScheduledTask } from "../../shared/automation.js";
import { legacyCronToSchedule } from "./automation-migration.js";
import { isValidCronExpression, nextFireTime } from "./cron.js";

const LEGACY_FIELDS = ["cron", "isOnce", "cwd", "modelKey"];
const COMMON_FIELDS = ["name", "prompt", "enabled", "executionMode", "skill"];

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Scheduled task input must be an object.");
	return value as Record<string, unknown>;
}

export function isLegacySchedulerInput(value: unknown): boolean {
	return LEGACY_FIELDS.some((key) => Object.hasOwn(record(value), key));
}

/** Only the official plugin boundary accepts the retired cron/cwd shape. V2 remains strict. */
export function adaptLegacySchedulerInput(value: unknown, current?: ScheduledTask): unknown {
	const input = record(value);
	if (!isLegacySchedulerInput(input)) return input;
	if (!Object.keys(input).every((key) => LEGACY_FIELDS.includes(key) || COMMON_FIELDS.includes(key))) {
		throw new Error("Do not mix legacy cron/cwd fields with schedule/runTarget/model.");
	}
	const output = Object.fromEntries(Object.entries(input).filter(([key]) => COMMON_FIELDS.includes(key)));
	if (input.isOnce !== undefined && typeof input.isOnce !== "boolean") throw new Error("isOnce must be a boolean.");
	if (input.cron !== undefined && (typeof input.cron !== "string" || !isValidCronExpression(input.cron)))
		throw new Error("Invalid legacy cron expression.");
	if (!current && input.cron === undefined) throw new Error("Legacy tasks require a cron expression.");
	if (input.cron !== undefined || input.isOnce !== undefined || !current) {
		const once = input.isOnce ?? current?.schedule.kind === "once";
		if (current?.schedule.kind === "once" && input.cron === undefined && once) {
			output.schedule = current.schedule;
		} else {
			let cron = input.cron as string | undefined;
			if (cron === undefined && current) {
				if (current.schedule.kind === "once") {
					const date = new Date(current.schedule.at);
					cron = `${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth() + 1} *`;
				} else cron = automationScheduleToCron(current.schedule) ?? undefined;
			}
			if (!cron) throw new Error("This interval cannot be represented by legacy cron. Use schedule instead.");
			if (once) {
				const at = nextFireTime({ kind: "custom", cron }, Date.now());
				if (at === null) throw new Error("The cron expression has no future execution.");
				output.schedule = { kind: "once", at };
			} else output.schedule = legacyCronToSchedule(cron, false, Date.now());
		}
	}
	if (input.cwd !== undefined || !current) {
		if (typeof input.cwd !== "string" || !input.cwd.trim())
			throw new Error("Legacy tasks require a working directory.");
		output.runTarget = { ...(current?.runTarget ?? { mode: "new-session" }), projectCwd: input.cwd };
	}
	if (input.modelKey !== undefined) {
		if (input.modelKey === null && current) output.model = null;
		else {
			if (typeof input.modelKey !== "string" || !input.modelKey.trim()) throw new Error("Invalid model key.");
			output.model = { key: input.modelKey };
		}
	}
	return output;
}
