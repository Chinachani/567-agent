import { describe, expect, it, vi } from "vitest";
import { legacyCronToSchedule } from "../../../../../main/scheduler/automation-migration";
import { type AutomationSchedule, automationScheduleToCron } from "../../../../../shared/automation";
import { isValidSchedule } from "../../../../../shared/automation-timing";

describe("scheduler cron conversion", () => {
	it.each<AutomationSchedule>([
		{ kind: "daily", hour: 9, minute: 15 },
		{ kind: "weekly", weekdays: [1, 3, 5], hour: 18, minute: 30 },
		{ kind: "custom", cron: "0 */4 * * *" },
		{ kind: "daily", hour: 0, minute: 0 },
	])("round-trips schedules produced by the picker", (schedule) => {
		expect(legacyCronToSchedule(automationScheduleToCron(schedule)!, false, Date.now())).toEqual(schedule);
	});
	it("round-trips a one-time schedule without changing its calendar date", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2028, 0, 1, 10, 0));
		try {
			expect(legacyCronToSchedule("5 8 20 6 *", true, Date.now())).toEqual({
				kind: "once",
				at: new Date(2028, 5, 20, 8, 5).getTime(),
			});
		} finally {
			vi.useRealTimers();
		}
	});
	it.each(["60 9 * * *", "0 24 * * *", "0 9 * * 7", "0 */0 * * *", "0 */two * * *", "*/30 * * * *"])(
		"preserves supported cron meaning and rejects invalid values: %s",
		(cron) => {
			const converted = legacyCronToSchedule(cron, false, Date.now());
			if (cron === "0 9 * * 7") expect(converted).toEqual({ kind: "weekly", weekdays: [0], hour: 9, minute: 0 });
			else if (cron === "*/30 * * * *") expect(converted).toEqual({ kind: "custom", cron });
			else expect(isValidSchedule(converted)).toBe(false);
		},
	);
});
