import type { EcosystemHookContributionSource } from "@567agent/ecosystem-adapter";
import type { PromptResourceRef } from "@567agent/runtime-core";
import type { SessionResourceRuntime } from "../index.js";

export interface ParsedSkillBlock {
	name: string;
	location: string;
	content: string;
	userMessage: string | undefined;
}

export interface PromptResourceExpansion {
	text: string;
	skillInjection?: string;
	promptResourceHookContribution?: EcosystemHookContributionSource;
	/** @deprecated Use promptResourceHookContribution. */
	skillHookContribution?: EcosystemHookContributionSource;
	promptRef?: PromptResourceRef;
}

export interface PromptResourceExpansionDependencies {
	resourceLoader: Pick<SessionResourceRuntime, "getSkills">;
	emitError?: (error: { extensionPath: string; event: string; error: string }) => void;
}
