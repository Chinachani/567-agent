import type { PersonaOption } from "@preload/api.js";
import { showToast } from "@shared/store/toast-atoms";
import { useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SETTINGS_SECTION } from "../registry";
import { recordSettingsUsage } from "./recordSettingsUsage";

const PERSONA_I18N_KEYS = {
	default: {
		label: "personas.default.label",
		description: "personas.default.description",
	},
	pragmatic: {
		label: "personas.pragmatic.label",
		description: "personas.pragmatic.description",
	},
	interactive: {
		label: "personas.interactive.label",
		description: "personas.interactive.description",
	},
} as const;

type PersonaI18nKey = (typeof PERSONA_I18N_KEYS)[keyof typeof PERSONA_I18N_KEYS]["label" | "description"];

function localizePersona(persona: PersonaOption, t: (key: PersonaI18nKey) => string): PersonaOption {
	const keys = PERSONA_I18N_KEYS[persona.id as keyof typeof PERSONA_I18N_KEYS];
	if (!keys) return persona;
	return {
		...persona,
		label: t(keys.label),
		description: t(keys.description),
	};
}

export interface AgentSettingsModel {
	actions: {
		applyPersonalization: () => Promise<boolean>;
		/** 放弃弹窗里未应用的草稿，回到已应用的自定义指令。 */
		discardCustomPromptDraft: () => void;
		/** 换人设：立即生效，只带上已应用的自定义指令，不把弹窗里没点应用的草稿一并写入。 */
		selectPersona: (value: string) => Promise<void>;
		setCustomPrompt: (value: string) => void;
		setPersonaId: (value: string) => void;
		toggleAgentSkills: (checked: boolean) => void;
		togglePromptPrediction: (checked: boolean) => void;
		toggleVettaCli: (checked: boolean) => void;
		setAdvancedOpen: (open: boolean) => void;
	};
	agentSkillsEnabled: boolean;
	advancedOpen: boolean;
	customPrompt: string;
	dirty: boolean;
	justSaved: boolean;
	labels: AgentSettingsLabels;
	personaId: string;
	personas: readonly PersonaOption[];
	promptPredictionEnabled: boolean;
	saving: boolean;
	selectedPersona?: PersonaOption;
	vettaCliEnabled: boolean;
}

interface AgentSettingsLabels {
	advancedTitle: string;
	advancedDescription: string;
	agentDescription: string;
	agentSkill: string;
	agentSkillDescription: string;
	appOp: string;
	appOpDescription: string;
	applied: string;
	apply: string;
	cancel: string;
	customInstructions: string;
	customInstructionsDescription: string;
	customInstructionsEdit: string;
	customInstructionsPlaceholder: string;
	defaultPersona: string;
	inputPrediction: string;
	inputPredictionDescription: string;
	persona: string;
	saving: string;
	sections: {
		experimental: string;
		personalization: string;
	};
	title: string;
}

export function useAgentSettingsModel(): AgentSettingsModel {
	const { t } = useTranslation("settings");
	const search = useSearch({ strict: false }) as Record<string, unknown>;
	const [advancedOpen, setAdvancedOpen] = useState(
		search.section === "agent-runtime" || search.h2 === "agent-runtime",
	);
	useEffect(() => {
		if (search.section === "agent-runtime" || search.h2 === "agent-runtime") setAdvancedOpen(true);
	}, [search.section, search.h2]);
	const [personas, setPersonas] = useState<PersonaOption[]>([]);
	const [personaId, setPersonaId] = useState("default");
	const [customPrompt, setCustomPrompt] = useState("");
	const [applied, setApplied] = useState({ personaId: "default", customPrompt: "" });
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [justSaved, setJustSaved] = useState(false);
	const [vettaCliEnabled, setVettaCliEnabled] = useState(true);
	const [promptPredictionEnabled, setPromptPredictionEnabled] = useState(false);
	const [agentSkillsEnabled, setAgentSkillsEnabled] = useState(true);

	useEffect(() => {
		void window.agent567.session.getPersonas().then(setPersonas);
		void window.agent567.session.getPersonalization().then((config) => {
			setPersonaId(config.personaId);
			setCustomPrompt(config.customPrompt);
			setApplied(config);
		});
		void window.agent567.config.get().then((config) => {
			setVettaCliEnabled(config.experimental?.vettaCli === true);
			setPromptPredictionEnabled(config.experimental?.promptPrediction === true);
			setAgentSkillsEnabled(config.experimental?.agentSkills !== false);
		});
	}, []);

	const toggleVettaCli = useCallback((checked: boolean) => {
		setVettaCliEnabled(checked);
		void window.agent567.config.set({ experimental: { vettaCli: checked } });
		recordSettingsUsage({ tab: "agent", action: checked ? "enabled" : "disabled", target: "vetta-cli" });
	}, []);

	const togglePromptPrediction = useCallback((checked: boolean) => {
		setPromptPredictionEnabled(checked);
		void window.agent567.config.set({ experimental: { promptPrediction: checked } });
		recordSettingsUsage({ tab: "agent", action: checked ? "enabled" : "disabled", target: "prompt-prediction" });
	}, []);

	const toggleAgentSkills = useCallback((checked: boolean) => {
		setAgentSkillsEnabled(checked);
		void window.agent567.config.set({ experimental: { agentSkills: checked } });
		recordSettingsUsage({ tab: "agent", action: checked ? "enabled" : "disabled", target: "agent-skills" });
	}, []);

	const dirty = customPrompt !== applied.customPrompt;

	const localizedPersonas = useMemo(() => personas.map((persona) => localizePersona(persona, t)), [personas, t]);
	const selectedPersona = localizedPersonas.find((persona) => persona.id === personaId);

	const persist = useCallback(
		async (next: { personaId: string; customPrompt: string }): Promise<boolean> => {
			if (savingRef.current) return false;
			savingRef.current = true;
			setSaving(true);
			try {
				await window.agent567.session.setPersonalization(next);
				setApplied(next);
				setPersonaId(next.personaId);
				recordSettingsUsage({
					tab: "agent",
					action: "saved",
					target: next.customPrompt.trim() ? "personalization-custom" : "personalization",
				});
				setJustSaved(true);
				setTimeout(() => setJustSaved(false), 1500);
				return true;
			} catch {
				showToast({ variant: "error", message: t("modelSettingsFeedback.saveFailed") });
				return false;
			} finally {
				savingRef.current = false;
				setSaving(false);
			}
		},
		[t],
	);

	const applyPersonalization = useCallback(
		() => persist({ personaId, customPrompt }),
		[customPrompt, personaId, persist],
	);

	const selectPersona = useCallback(
		async (value: string) => {
			await persist({ personaId: value, customPrompt: applied.customPrompt });
		},
		[applied.customPrompt, persist],
	);

	const discardCustomPromptDraft = useCallback(() => setCustomPrompt(applied.customPrompt), [applied.customPrompt]);

	const labels = useMemo<AgentSettingsLabels>(
		() => ({
			advancedTitle: t("agentSettings.advancedTitle"),
			advancedDescription: t("agentSettings.advancedDescription"),
			agentDescription: t("agentDescription"),
			agentSkill: t("agentSettings.agentSkill"),
			agentSkillDescription: t("agentSettings.agentSkillDesc"),
			appOp: t("agentSettings.appOp"),
			appOpDescription: t("agentSettings.appOpDesc"),
			applied: t("agentSettings.applied"),
			apply: t("agentSettings.apply"),
			cancel: t("cancel"),
			customInstructions: t("agentSettings.customInstructions"),
			customInstructionsDescription: t("agentSettings.customInstructionsDesc"),
			customInstructionsEdit: t("agentSettings.customInstructionsEdit"),
			customInstructionsPlaceholder: t("agentSettings.customInstructionsPlaceholder"),
			defaultPersona: t("agentSettings.default"),
			inputPrediction: t("agentSettings.inputPrediction"),
			inputPredictionDescription: t("agentSettings.inputPredictionDesc"),
			persona: t("agentSettings.persona"),
			saving: t("agentSettings.saving"),
			sections: {
				experimental: t(SETTINGS_SECTION["agent-experimental"].titleKey),
				personalization: t(SETTINGS_SECTION["agent-personalization"].titleKey),
			},
			title: t("agentSettings.title"),
		}),
		[t],
	);

	return {
		actions: {
			setAdvancedOpen,
			applyPersonalization,
			discardCustomPromptDraft,
			selectPersona,
			setCustomPrompt,
			setPersonaId,
			toggleAgentSkills,
			togglePromptPrediction,
			toggleVettaCli,
		},
		agentSkillsEnabled,
		advancedOpen,
		customPrompt,
		dirty,
		justSaved,
		labels,
		personaId,
		personas: localizedPersonas,
		promptPredictionEnabled,
		saving,
		selectedPersona,
		vettaCliEnabled,
	};
}
