import {
	Button,
	cn,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
	TEXTAREA_FILL_CLASS,
} from "@vetta-org/ui";
import { Switch } from "@vetta-org/ui";
import { useMemo, useState } from "react";
import { SettingsAiAssist } from "../ai-assist";
import { SETTINGS_SECTION } from "../registry";
import { MotionSelect, SettingRow, SettingSection } from "@vetta-org/theme-ui/settings";
import type { AgentSettingsModel } from "./useAgentSettingsModel";
import { RuntimeConfigurationSections } from "./RuntimeConfigurationSections";
import type { RuntimeConfigurationModel } from "./useRuntimeConfigurationModel";
import { ModelCallLimitSettingsView, type ModelCallLimitSettingsModel } from "@vetta-org/theme-ui/settings";

export interface AgentSettingsViewProps {
	model: AgentSettingsModel;
	runtimeConfiguration: RuntimeConfigurationModel;
	modelCallLimit: ModelCallLimitSettingsModel;
}

/** 自定义指令：设置项右侧只放一个入口按钮，点开 Dialog 编辑，点「应用」才写入；关闭未应用则放弃草稿。 */
function CustomInstructionsDialog({ model }: { model: AgentSettingsModel }): JSX.Element {
	const [open, setOpen] = useState(false);
	const close = (next: boolean) => {
		if (model.saving) return;
		if (!next) model.actions.discardCustomPromptDraft();
		setOpen(next);
	};
	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogTrigger asChild>
				<Button variant="field">
					<span className="icon-[mdi--pencil-outline] h-3.5 w-3.5 text-muted-foreground" />
					{model.labels.customInstructionsEdit}
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[520px]">
				<DialogHeader>
					<DialogTitle>{model.labels.customInstructions}</DialogTitle>
					<DialogDescription>{model.labels.customInstructionsDescription}</DialogDescription>
				</DialogHeader>
				<textarea
					value={model.customPrompt}
					disabled={model.saving}
					aria-label={model.labels.customInstructions}
					onChange={(event) => model.actions.setCustomPrompt(event.target.value)}
					placeholder={model.labels.customInstructionsPlaceholder}
					className={cn(TEXTAREA_FILL_CLASS, "w-full resize-y leading-relaxed")}
					style={{ minHeight: "200px" }}
				/>
				<DialogFooter>
					<Button variant="ghost" size="sm" disabled={model.saving} onClick={() => close(false)}>
						{model.labels.cancel}
					</Button>
					<Button
						variant="primary"
						size="sm"
						className="min-w-[76px]"
						disabled={!model.dirty || model.saving}
						onClick={() =>
							void model.actions.applyPersonalization().then((saved) => {
								if (saved) setOpen(false);
							})
						}
					>
						{model.saving ? model.labels.saving : model.labels.apply}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function AgentSettingsView({
	model,
	modelCallLimit,
	runtimeConfiguration,
}: AgentSettingsViewProps): JSX.Element {
	const personaOptions = useMemo(
		() => model.personas.map((persona) => ({ value: persona.id, label: persona.label })),
		[model.personas],
	);

	return (
		<div className="mx-auto w-full max-w-[800px] px-5 pt-6 sm:px-8 pb-4">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-[24px] font-semibold tracking-tight text-foreground">{model.labels.title}</h1>
				<SettingsAiAssist tabId="agent" />
			</div>

			<SettingSection
				title={model.labels.sections.personalization}
				section={SETTINGS_SECTION["agent-personalization"]}
				description={model.labels.agentDescription}
			>
				<SettingRow title={model.labels.persona} description={model.selectedPersona?.description}>
					<MotionSelect
						value={model.personaId}
						disabled={model.saving}
						onValueChange={(value) => void model.actions.selectPersona(value)}
						options={personaOptions}
						placeholder={model.labels.defaultPersona}
						aria-label={model.labels.persona}
					/>
				</SettingRow>
				<SettingRow
					title={model.labels.customInstructions}
					description={model.labels.customInstructionsDescription}
					border={false}
				>
					<CustomInstructionsDialog model={model} />
				</SettingRow>
			</SettingSection>

			<ModelCallLimitSettingsView model={modelCallLimit} />
			<div>
				<SettingSection title={model.labels.sections.experimental} section={SETTINGS_SECTION["agent-experimental"]}>
					<SettingRow title={model.labels.appOp} description={model.labels.appOpDescription}>
						<Switch checked={model.vettaCliEnabled} onCheckedChange={model.actions.toggleVettaCli} />
					</SettingRow>
					<SettingRow title={model.labels.inputPrediction} description={model.labels.inputPredictionDescription}>
						<Switch
							checked={model.promptPredictionEnabled}
							onCheckedChange={model.actions.togglePromptPrediction}
						/>
					</SettingRow>
					<SettingRow
						title={model.labels.agentSkill}
						description={model.labels.agentSkillDescription}
						border={false}
					>
						<Switch checked={model.agentSkillsEnabled} onCheckedChange={model.actions.toggleAgentSkills} />
					</SettingRow>
				</SettingSection>
			</div>

			{runtimeConfiguration.sections.length > 0 && (
				<details
					className="group mt-6 rounded-xl border border-border"
					open={model.advancedOpen}
					onToggle={(event) => model.actions.setAdvancedOpen(event.currentTarget.open)}
				>
					<summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl p-4 outline-none focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
						<span className="min-w-0 flex-1">
							<span className="block text-[13px] font-medium text-foreground">{model.labels.advancedTitle}</span>
							<span className="mt-1 block text-[12px] leading-relaxed text-muted-foreground">
								{model.labels.advancedDescription}
							</span>
						</span>
						<span
							aria-hidden="true"
							className="icon-[solar--alt-arrow-down-linear] h-4 w-4 shrink-0 text-muted-foreground group-open:rotate-180"
						/>
					</summary>
					<div className="px-2 pb-2">
						<RuntimeConfigurationSections model={runtimeConfiguration} />
					</div>
				</details>
			)}
		</div>
	);
}
