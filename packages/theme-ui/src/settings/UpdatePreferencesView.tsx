import { Button, Switch } from "@vetta-org/ui";
import type { JSX } from "react";
import { MotionSelect } from "./MotionSelect";
import { SettingRow } from "./SettingChrome";

export interface UpdatePreferencesViewProps {
	preferences: {
		automaticCheck: boolean;
		automaticDownload: boolean;
		showReminder: boolean;
		checkIntervalMinutes: number;
	} | null;
	busy: boolean;
	error: string;
	labels: Record<
		| "notes"
		| "notesDescription"
		| "open"
		| "releasePage"
		| "automaticCheck"
		| "automaticCheckDescription"
		| "interval"
		| "automaticDownload"
		| "automaticDownloadDescription"
		| "showReminder"
		| "showReminderDescription"
		| "restart"
		| "restartDescription"
		| "retry"
		| "loading",
		string
	>;
	intervals: { value: string; label: string }[];
	onChange: (value: NonNullable<UpdatePreferencesViewProps["preferences"]>) => void;
	onRetry: () => void;
	onOpenNotes: () => void;
	onOpenReleasePage: () => void;
}

/** Rows can be composed into the host's existing app settings section. */
export function UpdatePreferencesView({
	preferences,
	busy,
	error,
	labels,
	intervals,
	onChange,
	onRetry,
	onOpenNotes,
	onOpenReleasePage,
}: UpdatePreferencesViewProps): JSX.Element {
	return (
		<>
			<SettingRow title={labels.notes} description={labels.notesDescription}>
				<div className="flex flex-wrap gap-2">
					<Button size="sm" variant="outline" onClick={onOpenNotes}>
						{labels.open}
					</Button>
					<Button size="sm" variant="ghost" onClick={onOpenReleasePage}>
						{labels.releasePage}
					</Button>
				</div>
			</SettingRow>
			{!preferences && !error && (
				<output className="px-4 py-3 text-[12px] text-muted-foreground">{labels.loading}</output>
			)}
			{error && (
				<div role="alert" className="flex flex-wrap items-center gap-2 px-4 py-3 text-[12px] text-destructive">
					{error}
					<Button size="sm" variant="outline" disabled={busy} onClick={onRetry}>
						{labels.retry}
					</Button>
				</div>
			)}
			{preferences && (
				<>
					<SettingRow title={labels.automaticCheck} description={labels.automaticCheckDescription}>
						<Switch
							aria-label={labels.automaticCheck}
							checked={preferences.automaticCheck}
							disabled={busy}
							onCheckedChange={(automaticCheck) => onChange({ ...preferences, automaticCheck })}
						/>
					</SettingRow>
					<SettingRow title={labels.interval}>
						<MotionSelect
							aria-label={labels.interval}
							value={String(preferences.checkIntervalMinutes)}
							options={intervals}
							disabled={busy || !preferences.automaticCheck}
							onValueChange={(value) => onChange({ ...preferences, checkIntervalMinutes: Number(value) })}
						/>
					</SettingRow>
					<SettingRow title={labels.automaticDownload} description={labels.automaticDownloadDescription}>
						<Switch
							aria-label={labels.automaticDownload}
							checked={preferences.automaticDownload}
							disabled={busy}
							onCheckedChange={(automaticDownload) => onChange({ ...preferences, automaticDownload })}
						/>
					</SettingRow>
					<SettingRow title={labels.showReminder} description={labels.showReminderDescription}>
						<Switch
							aria-label={labels.showReminder}
							checked={preferences.showReminder}
							disabled={busy}
							onCheckedChange={(showReminder) => onChange({ ...preferences, showReminder })}
						/>
					</SettingRow>
				</>
			)}
			<SettingRow title={labels.restart} description={labels.restartDescription}>
				<span className="icon-[solar--info-circle-linear] h-4 w-4 text-muted-foreground" />
			</SettingRow>
		</>
	);
}
