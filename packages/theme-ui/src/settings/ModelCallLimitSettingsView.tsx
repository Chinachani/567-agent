import type { JSX } from "react";
import { Button, Switch } from "@vetta-org/ui";
import { SettingRow, SettingSection } from "./SettingChrome";
import { InputField } from "./SettingsFormFields";

export interface ModelCallLimitSettingsModel {
	readonly loading: boolean;
	readonly saving: boolean;
	readonly enabled: boolean;
	readonly limit: string;
	readonly invalid: boolean;
	readonly canSave: boolean;
	readonly error?: string;
	readonly status?: string;
	readonly labels: {
		readonly title: string;
		readonly limit: string;
		readonly description: string;
		readonly maxCalls: string;
		readonly timing: string;
		readonly unlimited: string;
		readonly invalid: string;
		readonly save: string;
		readonly saving: string;
		readonly reset: string;
		readonly retry: string;
	};
	readonly actions: {
		readonly setEnabled: (enabled: boolean) => void;
		readonly setLimit: (value: string) => void;
		readonly save: () => void;
		readonly reset: () => void;
		readonly reload: () => void;
	};
}

export function ModelCallLimitSettingsView({ model }: { model: ModelCallLimitSettingsModel }): JSX.Element {
	const { labels, actions } = model;
	const busy = model.loading || model.saving;
	return (
		<section aria-labelledby="agent-model-call-limit">
			<form
				onSubmit={(event) => {
					event.preventDefault();
					actions.save();
				}}
				aria-busy={busy}
			>
				<SettingSection section={{ id: "agent-model-call-limit" }} title={labels.title}>
					<SettingRow title={labels.limit} description={labels.description}>
						<Switch
							aria-label={labels.limit}
							checked={model.enabled}
							disabled={busy}
							onCheckedChange={actions.setEnabled}
						/>
					</SettingRow>
					<SettingRow title={labels.maxCalls} description={labels.timing} border={false}>
						<div className="flex items-center gap-2">
							<InputField
								aria-label={labels.maxCalls}
								aria-invalid={model.invalid}
								aria-describedby={model.invalid ? "model-call-limit-invalid" : undefined}
								inputMode="numeric"
								value={model.limit}
								onChange={actions.setLimit}
								disabled={busy || !model.enabled}
								className="w-28 tabular-nums aria-invalid:border-destructive aria-invalid:focus-visible:border-destructive"
							/>
							{[50, 100, 200, 500].map((value) => (
								<Button
									type="button"
									key={value}
									variant="ghost"
									size="sm"
									disabled={busy || !model.enabled}
									onClick={() => actions.setLimit(String(value))}
								>
									{value}
								</Button>
							))}
						</div>
					</SettingRow>
					<div className="space-y-2 px-4 pb-4 text-[12px] text-muted-foreground">
						{!model.enabled && <p>{labels.unlimited}</p>}
						{model.invalid && (
							<p id="model-call-limit-invalid" role="alert" className="text-destructive">
								{labels.invalid}
							</p>
						)}
						{model.error && (
							<div className="flex flex-wrap items-center gap-2">
								<p role="alert" className="text-destructive">
									{model.error}
								</p>
								<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={actions.reload}>
									{labels.retry}
								</Button>
							</div>
						)}
						{model.status && <p role="status">{model.status}</p>}
						<div className="flex items-center justify-end gap-2 pt-1">
							<Button type="button" variant="ghost" size="sm" disabled={busy} onClick={actions.reset}>
								{labels.reset}
							</Button>
							<Button type="submit" variant="primary" size="sm" disabled={!model.canSave}>
								{model.saving ? labels.saving : labels.save}
							</Button>
						</div>
					</div>
				</SettingSection>
			</form>
		</section>
	);
}
