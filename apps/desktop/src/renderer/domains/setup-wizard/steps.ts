import { isMac } from "@shared/lib/platform";

export type SetupWizardStepId = "permissions" | "languageAppearance" | "groupSelection" | "welcome";

/** macOS: language/appearance → permissions → groups → welcome; other platforms skip permissions. */
export function getSetupWizardSteps(): readonly SetupWizardStepId[] {
	return isMac
		? ["languageAppearance", "permissions", "groupSelection", "welcome"]
		: ["languageAppearance", "groupSelection", "welcome"];
}
