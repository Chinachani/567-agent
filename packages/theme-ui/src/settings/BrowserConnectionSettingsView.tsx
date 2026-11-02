import { useState, type JSX } from "react";
import { Button } from "@vetta-org/ui";
import { SettingRow, SettingSection } from "./SettingChrome";
import { InputField } from "./SettingsFormFields";
import { BrowserConnectionSetupGuide } from "./BrowserConnectionSetupGuide";
import { MotionSelect, type MotionSelectOption } from "./MotionSelect";

export interface BrowserConnectionSettingsModel {
	readonly preferBundledInstall: boolean;
	readonly extensionDirectory?: string;
	readonly copiedDirectory: boolean;
	readonly target: string;
	readonly targetOptions: readonly MotionSelectOption[];
	readonly targetDescription: string;
	readonly targetSummary: string;
	readonly targetDirty: boolean;
	readonly canInstall: boolean;
	readonly canSave: boolean;
	readonly copiedStoreLink: boolean;
	readonly loading: boolean;
	readonly saving: boolean;
	readonly enabled: boolean;
	readonly conflict: boolean;
	readonly token: string;
	readonly profile: string;
	readonly feedback?: string;
	readonly error?: string;
	readonly labels: {
		readonly target: string;
		readonly chooseTarget: string;
		readonly saveTarget: string;
		readonly targetHint: string;
		readonly title: string;
		readonly description: string;
		readonly setup: string;
		readonly startInstall: string;
		readonly connection: string;
		readonly state: string;
		readonly enable: string;
		readonly save: string;
		readonly disable: string;
		readonly retry: string;
		readonly advanced: string;
		readonly token: string;
		readonly tokenHint: string;
		readonly profile: string;
		readonly profileHint: string;
		readonly guide: string;
	};
	readonly guideLabels: {
		readonly bundleTitle: string;
		readonly bundleBody: string;
		readonly prepareBundle: string;
		readonly copyDirectory: string;
		readonly copiedDirectory: string;
		readonly loadTitle: string;
		readonly loadSteps: readonly string[];
		readonly bundleHint: string;
		readonly title: string;
		readonly description: string;
		readonly installTitle: string;
		readonly installBody: string;
		readonly chrome: string;
		readonly chromeInstructions: string;
		readonly edge: string;
		readonly edgeInstructions: string;
		readonly openStore: string;
		readonly copyLink: string;
		readonly copied: string;
		readonly wrongBrowser: string;
		readonly configureTitle: string;
		readonly configureBody: string;
		readonly configured: string;
		readonly authorizeTitle: string;
		readonly authorizeBody: string;
		readonly tryPrompt: string;
		readonly troubleshooting: string;
		readonly troubleshootingBody: string;
		readonly advancedHint: string;
		readonly close: string;
	};
	readonly actions: {
		readonly prepareBundle: () => void;
		readonly copyDirectory: () => void;
		readonly setTarget: (value: string) => void;
		readonly startInstall: () => void;
		readonly copyStoreLink: () => void;
		readonly openStore: () => void;
		readonly openGuide: () => void;
		readonly reload: () => void;
		readonly save: () => void;
		readonly disable: () => void;
		readonly setToken: (value: string) => void;
		readonly setProfile: (value: string) => void;
	};
}

export function BrowserConnectionSettingsView({ model }: { model: BrowserConnectionSettingsModel }): JSX.Element {
	const [guideOpen, setGuideOpen] = useState(false);
	const { labels, actions } = model;
	const busy = model.loading || model.saving;
	return (
		<section aria-labelledby="general-browser-connection">
			<SettingSection
				section={{ id: "general-browser-connection" }}
				title={labels.title}
				description={labels.description}
			>
				<SettingRow title={labels.target} description={model.targetDescription}>
					<div className="flex flex-wrap items-center gap-2">
						<MotionSelect
							aria-label={labels.target}
							value={model.target}
							options={model.targetOptions}
							placeholder={labels.chooseTarget}
							onValueChange={actions.setTarget}
							disabled={busy || model.conflict}
						/>
						{model.enabled && model.targetDirty && (
							<Button
								variant="outline"
								size="sm"
								disabled={busy || model.conflict || !model.canSave}
								onClick={actions.save}
							>
								{labels.saveTarget}
							</Button>
						)}
					</div>
				</SettingRow>
				<SettingRow title={labels.connection} description={labels.state} border={false}>
					<div className="flex flex-wrap items-center gap-2">
						<BrowserConnectionSetupGuide model={model} open={guideOpen} onOpenChange={setGuideOpen} />
						{model.enabled ? (
							<Button variant="outline" size="sm" disabled={busy} onClick={actions.disable}>
								{labels.disable}
							</Button>
						) : (
							<Button
								variant="primary"
								size="sm"
								disabled={busy || model.conflict || !model.canInstall}
								onClick={() => {
									if (model.preferBundledInstall) setGuideOpen(true);
									actions.startInstall();
								}}
							>
								{labels.startInstall}
							</Button>
						)}
					</div>
				</SettingRow>
				<p className="px-4 pb-3 text-[11px] leading-relaxed text-muted-foreground">{labels.targetHint}</p>
				<details className="group border-t border-border px-4 py-3">
					<summary className="flex cursor-pointer list-none items-center gap-2 rounded-md text-[12px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
						<span>{labels.advanced}</span>
						<span
							aria-hidden="true"
							className="icon-[solar--alt-arrow-down-linear] ml-auto size-3.5 transition-transform group-open:rotate-180"
						/>
					</summary>
					<div className="mt-3 flex flex-col gap-4">
						<label className="flex flex-col gap-1.5 text-[12px]">
							<span>{labels.token}</span>
							<InputField
								aria-label={labels.token}
								type="password"
								value={model.token}
								onChange={actions.setToken}
								disabled={busy || model.conflict}
							/>
							<span className="text-[11px] leading-relaxed text-muted-foreground">{labels.tokenHint}</span>
						</label>
						<label className="flex flex-col gap-1.5 text-[12px]">
							<span>{labels.profile}</span>
							<InputField
								aria-label={labels.profile}
								value={model.profile}
								onChange={actions.setProfile}
								disabled={busy || model.conflict}
							/>
							<span className="text-[11px] leading-relaxed text-muted-foreground">{labels.profileHint}</span>
						</label>
						<div className="flex flex-wrap items-center gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={busy || model.conflict || !model.canSave}
								onClick={actions.save}
							>
								{model.enabled ? labels.save : labels.enable}
							</Button>
							<Button variant="ghost" size="sm" onClick={actions.openGuide}>
								{labels.guide}
							</Button>
						</div>
					</div>
				</details>
				{model.feedback && (
					<p role="status" className="px-4 pb-3 text-[12px] text-muted-foreground">
						{model.feedback}
					</p>
				)}
				{model.error && (
					<div className="flex flex-wrap items-center gap-2 px-4 pb-3">
						<p role="alert" className="text-[12px] text-destructive">
							{model.error}
						</p>
						<Button variant="ghost" size="sm" disabled={busy} onClick={actions.reload}>
							{labels.retry}
						</Button>
					</div>
				)}
			</SettingSection>
		</section>
	);
}
