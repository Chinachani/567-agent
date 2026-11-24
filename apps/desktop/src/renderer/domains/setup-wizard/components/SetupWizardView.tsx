import { useState } from "react";
import { GroupSelectionStep, GROUP_FORM_ID } from "./steps/GroupSelectionStep";
import { cn } from "@shared/lib/utils";
import { Button } from "@vetta-org/ui";
import type { SetupWizardModel } from "../hooks/useSetupWizard";
import type { SetupWizardStepId } from "../steps";
import { LanguageAppearanceStep } from "./steps/LanguageAppearanceStep";
import { PermissionsStep } from "./steps/PermissionsStep";
import { WelcomeStep } from "./steps/WelcomeStep";

function StepBody({
	step,
	onComplete,
	onNext,
	onBusy,
}: {
	step: SetupWizardStepId;
	onComplete: () => void;
	onNext: () => void;
	onBusy: (busy: boolean) => void;
}): JSX.Element {
	switch (step) {
		case "permissions":
			return <PermissionsStep />;
		case "languageAppearance":
			return <LanguageAppearanceStep />;
		case "groupSelection":
			return <GroupSelectionStep onNext={onNext} onBusy={onBusy} />;
		case "welcome":
			return <WelcomeStep onComplete={onComplete} />;
	}
}

function StepIndicator({ stepIndex, totalSteps }: { stepIndex: number; totalSteps: number }): JSX.Element {
	return (
		<div className="flex items-center gap-2" aria-hidden>
			{Array.from({ length: totalSteps }, (_, i) => {
				const active = i === stepIndex;
				const done = i < stepIndex;
				return (
					<span
						key={i}
						className={cn(
							"block h-1.5 rounded-full transition-[width,background-color] duration-200 ease-out",
							active ? "w-5 bg-primary" : done ? "w-1.5 bg-primary/50" : "w-1.5 bg-muted-foreground/25",
						)}
					/>
				);
			})}
		</div>
	);
}

export function SetupWizardView({ model }: { model: SetupWizardModel }): JSX.Element | null {
	const [busy, setBusy] = useState(false);
	if (!model.open) return null;

	const { actions, currentStep, isFirst, isLast, labels, stepIndex, totalSteps } = model;

	return (
		<div className="fixed inset-0 z-[100] flex flex-col bg-background text-foreground">
			{/* macOS traffic-light 区拖拽 + 右上角 Skip */}
			<div className="relative flex h-12 shrink-0 items-center justify-end px-4 [-webkit-app-region:drag]">
				<Button
					variant="ghost"
					size="sm"
					className="relative z-10 [-webkit-app-region:no-drag] text-muted-foreground"
					disabled={busy}
					onClick={actions.skip}
				>
					{labels.skip}
				</Button>
			</div>

			<div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-6 pb-2 pt-1">
				<div className="flex w-full max-w-[560px] flex-1 flex-col justify-center py-3">
					<div key={currentStep} className="setup-wizard-enter">
						<StepBody step={currentStep} onComplete={actions.complete} onNext={actions.next} onBusy={setBusy} />
					</div>
				</div>
			</div>

			{/* 无边框 stepper：指示点 + 操作，居中紧凑 */}
			<div className="flex shrink-0 flex-col items-center gap-4 px-6 pb-10 pt-2">
				<StepIndicator stepIndex={stepIndex} totalSteps={totalSteps} />

				<div className="flex items-center gap-3">
					<div className="flex h-9 w-[5.5rem] items-center justify-end">
						{!isFirst && (
							<div className="setup-wizard-enter">
								<Button
									variant="ghost"
									size="sm"
									disabled={busy}
									onClick={actions.back}
									className="gap-1 text-muted-foreground transition-transform hover:-translate-x-0.5 hover:text-foreground active:scale-[0.96]"
								>
									<span className="icon-[solar--alt-arrow-left-linear] h-3.5 w-3.5" />
									{labels.back}
								</Button>
							</div>
						)}
					</div>

					<div key={isLast ? "done" : "next"} className="setup-wizard-enter min-w-[9.5rem]">
						<Button
							className="h-9 w-full gap-1.5 px-5 transition-[transform,background-color] hover:scale-[1.02] active:scale-[0.97]"
							disabled={busy}
							type={currentStep === "groupSelection" ? "submit" : "button"}
							form={currentStep === "groupSelection" ? GROUP_FORM_ID : undefined}
							onClick={currentStep === "groupSelection" ? undefined : isLast ? actions.complete : actions.next}
						>
							{isLast ? labels.getStarted : labels.next}
							<span
								className={
									isLast
										? "icon-[solar--arrow-right-linear] h-3.5 w-3.5"
										: "icon-[solar--alt-arrow-right-linear] h-3.5 w-3.5"
								}
							/>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
