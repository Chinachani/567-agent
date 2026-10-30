export interface UpdaterPreferences {
	automaticCheck: boolean;
	checkIntervalMinutes: number;
	automaticDownload: boolean;
	showReminder: boolean;
}

export const UPDATE_CHECK_INTERVALS = [30, 60, 120, 360, 1440] as const;
export const DEFAULT_UPDATER_PREFERENCES: UpdaterPreferences = {
	automaticCheck: true,
	checkIntervalMinutes: 120,
	automaticDownload: true,
	showReminder: true,
};

export function normalizeUpdaterPreferences(value: unknown): UpdaterPreferences {
	const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	return {
		automaticCheck: typeof input.automaticCheck === "boolean" ? input.automaticCheck : true,
		checkIntervalMinutes: UPDATE_CHECK_INTERVALS.some((interval) => interval === input.checkIntervalMinutes)
			? (input.checkIntervalMinutes as number)
			: 120,
		automaticDownload: typeof input.automaticDownload === "boolean" ? input.automaticDownload : true,
		showReminder: typeof input.showReminder === "boolean" ? input.showReminder : true,
	};
}

export interface UpdateReleaseNote {
	version: string;
	body: string;
	url: string;
	publishedAt: string;
}
export interface UpdateReleaseHistory {
	baselineVersion: string;
	releases: UpdateReleaseNote[];
}
