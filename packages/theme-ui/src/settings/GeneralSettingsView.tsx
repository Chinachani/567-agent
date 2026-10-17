import type { JSX, ReactNode } from "react";
import { Button, Switch } from "@vetta-org/ui";
import { MotionSelect } from "./MotionSelect";
import { SettingRow, SettingSection, type SettingSectionMeta } from "./SettingChrome";
import { InputField } from "./SettingsFormFields";

export interface GeneralSettingsViewLabels {
	readonly title: string;
	readonly sections: {
		readonly basics: string;
		readonly app: string;
		readonly developer: string;
	};
	readonly workspaceTitle: string;
	readonly workspaceDescription: string;
	readonly sandboxTitle: string;
	readonly sandboxDescription: string;
	readonly systemNotifications: string;
	readonly systemNotificationsDescription: string;
	readonly debugMode: string;
	readonly debugModeDescription: string;
	readonly exportDiagnostics: string;
	readonly exportDiagnosticsDescription: string;
	readonly startAppGuide: string;
	readonly startAppGuideDescription: string;
	readonly startAppGuideAction: string;
	/** App updates row title, e.g. "当前版本". */
	readonly appVersion: string;
	readonly updateSource: string;
	readonly updateSourceDescription: string;
	readonly updateSourceOfficial: string;
	readonly updateSourceAccelerated: string;
	readonly updateSourceCustom: string;
	readonly updateSourceCustomHint: string;
	readonly updateSourceCustomPlaceholder: string;
	readonly updateSourceSave: string;
	readonly updateSourceSaving: string;
	readonly updateSourceSaved: string;
	readonly updateSourceInvalid: string;
	readonly updateSourceSaveFailed: string;
	readonly fullAccess: string;
	readonly useSandbox: string;
	readonly export: string;
	readonly exporting: string;
	readonly reset: string;
}

export interface GeneralSettingsViewProps {
	readonly labels: GeneralSettingsViewLabels;
	readonly sections: {
		readonly basics: SettingSectionMeta;
		readonly app: SettingSectionMeta;
		readonly developer: SettingSectionMeta;
	};
	readonly workspacePath: string;
	readonly onSelectWorkspace: () => void;
	readonly onResetWorkspace: () => void;
	/** 与 App 引导同构：description + 右侧 action；有更新时 detail 挂在行下。 */
	readonly updatesDescription: string;
	readonly updatesAction: ReactNode;
	readonly updatesDetail: ReactNode;
	readonly updateSource: "github" | "gh-proxy" | "custom";
	readonly updateProxyUrl: string;
	readonly updateProxyUrlValid: boolean;
	readonly updateSourceSaveState: "idle" | "saving" | "saved" | "error";
	readonly onUpdateSourceChange: (source: "github" | "gh-proxy" | "custom") => void;
	readonly onUpdateProxyUrlChange: (url: string) => void;
	readonly onSaveUpdateProxyUrl: () => void;
	readonly executionMode: string;
	readonly onExecutionModeChange: (mode: string) => void;
	readonly sandboxUnavailableReason: string | null;
	readonly notificationsEnabled: boolean;
	readonly onNotificationsChange: (checked: boolean) => void;
	readonly debugMode: boolean;
	readonly onDebugChange: (checked: boolean) => void;
	readonly exportingDiagnostics: boolean;
	readonly onExportDiagnostics: () => void;
	readonly onStartAppGuide: () => void;
}

/**
 * Settings general page layout. Host chrome uses `@vetta-org/ui` primitives (not desktop components/ui).
 * UpdateChecker stays host-injected (desktop-connected).
 *
 * Grouped into 3 sections to reduce one-setting-per-card scatter:
 * - basics: workspace, sandbox, notifications
 * - app: updates, setup guide
 * - developer: debug mode, diagnostics export
 */
export function GeneralSettingsView({
	labels,
	sections,
	workspacePath,
	onSelectWorkspace,
	onResetWorkspace,
	updatesDescription,
	updatesAction,
	updatesDetail,
	updateSource,
	onUpdateSourceChange,
	updateProxyUrl,
	updateProxyUrlValid,
	updateSourceSaveState,
	onUpdateProxyUrlChange,
	onSaveUpdateProxyUrl,
	executionMode,
	onExecutionModeChange,
	sandboxUnavailableReason,
	notificationsEnabled,
	onNotificationsChange,
	debugMode,
	onDebugChange,
	exportingDiagnostics,
	onExportDiagnostics,
	onStartAppGuide,
}: GeneralSettingsViewProps): JSX.Element {
	const invalidUpdateProxyUrl = updateProxyUrl.trim().length > 0 && !updateProxyUrlValid;
	const updateProxyStatusLabel =
		updateSourceSaveState === "saved"
			? labels.updateSourceSaved
			: updateSourceSaveState === "saving"
				? labels.updateSourceSaving
				: updateSourceSaveState === "error"
					? labels.updateSourceSaveFailed
					: invalidUpdateProxyUrl
						? labels.updateSourceInvalid
						: labels.updateSourceCustomHint;
	return (
		<div className="mx-auto w-full max-w-[680px] px-8 pt-2 pb-4">
			<h1 className="mb-6 text-[20px] font-bold text-foreground">{labels.title}</h1>

			<SettingSection title={labels.sections.basics} section={sections.basics}>
				<SettingRow title={labels.workspaceTitle} description={labels.workspaceDescription}>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={onSelectWorkspace}
							className="flex items-center gap-2 rounded-lg border border-input bg-secondary px-3 py-1.5 text-[12px] text-foreground transition-colors hover:bg-accent"
						>
							<span className="icon-[mdi--folder-outline] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
							<span className="max-w-[180px] truncate">{workspacePath}</span>
							<span className="icon-[mdi--chevron-down] h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						</button>
						<button
							type="button"
							onClick={onResetWorkspace}
							className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							title={labels.reset}
						>
							<span className="icon-[mdi--restore] h-3.5 w-3.5" />
						</button>
					</div>
				</SettingRow>
				<SettingRow title={labels.sandboxTitle} description={labels.sandboxDescription}>
					<MotionSelect
						value={executionMode}
						onValueChange={onExecutionModeChange}
						triggerClassName="min-w-[120px]"
						options={[
							{ value: "full-access", label: labels.fullAccess },
							{
								value: "sandbox",
								label: labels.useSandbox,
								disabled: Boolean(sandboxUnavailableReason),
								title: sandboxUnavailableReason ?? undefined,
							},
						]}
					/>
				</SettingRow>
				<SettingRow
					title={labels.systemNotifications}
					description={labels.systemNotificationsDescription}
					border={false}
				>
					<Switch checked={notificationsEnabled} onCheckedChange={onNotificationsChange} />
				</SettingRow>
			</SettingSection>

			<SettingSection title={labels.sections.app} section={sections.app}>
				{/* 与下方 App 引导同一 SettingRow：左标题+描述，右 outline sm 按钮。 */}
				<SettingRow title={labels.appVersion} description={updatesDescription || undefined} border={!updatesDetail}>
					{updatesAction}
				</SettingRow>
				{updatesDetail ? <div className="border-b border-border px-5 pb-4">{updatesDetail}</div> : null}
				<SettingRow title={labels.updateSource} description={labels.updateSourceDescription}>
					<MotionSelect
						value={updateSource}
						disabled={updateSourceSaveState === "saving"}
						onValueChange={(value) =>
							onUpdateSourceChange(value === "gh-proxy" || value === "custom" ? value : "github")
						}
						triggerClassName="min-w-[150px]"
						options={[
							{ value: "github", label: labels.updateSourceOfficial },
							{ value: "gh-proxy", label: labels.updateSourceAccelerated },
							{ value: "custom", label: labels.updateSourceCustom },
						]}
					/>
				</SettingRow>
				{updateSource !== "custom" && updateSourceSaveState !== "idle" && (
					<p
						role={updateSourceSaveState === "error" ? "alert" : "status"}
						className="pb-3 text-[11px] text-muted-foreground"
					>
						{updateSourceSaveState === "saving"
							? labels.updateSourceSaving
							: updateSourceSaveState === "saved"
								? labels.updateSourceSaved
								: labels.updateSourceSaveFailed}
					</p>
				)}
				{updateSource === "custom" ? (
					<SettingRow title={labels.updateSourceCustom} description={labels.updateSourceDescription}>
						<div className="flex w-full min-w-0 max-w-[24rem] flex-col gap-1.5">
							<div className="flex items-center gap-2">
								<InputField
									value={updateProxyUrl}
									onChange={onUpdateProxyUrlChange}
									placeholder={labels.updateSourceCustomPlaceholder}
									disabled={updateSourceSaveState === "saving"}
									aria-label={labels.updateSourceCustom}
									className="min-w-0 flex-1"
								/>
								<Button
									size="sm"
									variant="outline"
									disabled={!updateProxyUrlValid || updateSourceSaveState === "saving"}
									onClick={onSaveUpdateProxyUrl}
								>
									{updateSourceSaveState === "saving" ? labels.updateSourceSaving : labels.updateSourceSave}
								</Button>
							</div>
							<div className="text-[11px] text-muted-foreground">{updateProxyStatusLabel}</div>
						</div>
					</SettingRow>
				) : null}
				<SettingRow title={labels.startAppGuide} description={labels.startAppGuideDescription} border={false}>
					<Button size="sm" variant="outline" onClick={onStartAppGuide}>
						{labels.startAppGuideAction}
					</Button>
				</SettingRow>
			</SettingSection>

			<SettingSection title={labels.sections.developer} section={sections.developer}>
				<SettingRow title={labels.debugMode} description={labels.debugModeDescription}>
					<Switch checked={debugMode} onCheckedChange={onDebugChange} />
				</SettingRow>
				<SettingRow
					title={labels.exportDiagnostics}
					description={labels.exportDiagnosticsDescription}
					border={false}
				>
					<Button size="sm" variant="outline" disabled={exportingDiagnostics} onClick={onExportDiagnostics}>
						{exportingDiagnostics ? labels.exporting : labels.export}
					</Button>
				</SettingRow>
			</SettingSection>
		</div>
	);
}
