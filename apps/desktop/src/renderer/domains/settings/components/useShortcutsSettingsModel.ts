import {
	getEffectiveShortcut,
	loadShortcutBindings,
	SHORTCUT_ACTIONS,
	type ShortcutBindings,
	saveShortcutBindings,
} from "@shared/lib/shortcuts";
import { showToast } from "@shared/store/toast-atoms";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { recordSettingsUsage } from "./recordSettingsUsage";

export type QuickPanelBehavior = "foreground" | "background";
export type QuickPanelTrigger = "none" | "mod" | "alt" | "shift";

export interface ShortcutActionItem {
	id: string;
	label: string;
	description: string;
	effectiveShortcut: string;
	isDefault: boolean;
}

export interface QuickPanelOption {
	value: QuickPanelTrigger | QuickPanelBehavior;
	label: string;
}

export interface ShortcutsSettingsModel {
	title: string;
	resetAllLabel: string;
	shortcutHint: string;
	shortcutPlaceholder: string;
	resetLabel: string;
	globalSectionTitle: string;
	shortcutActions: ShortcutActionItem[];
	quickPanel: {
		trigger: QuickPanelTrigger;
		behavior: QuickPanelBehavior;
		sectionTitle: string;
		triggerTitle: string;
		triggerDescription: string;
		behaviorTitle: string;
		behaviorDescription: string;
		triggerOptions: QuickPanelOption[];
		behaviorOptions: QuickPanelOption[];
		behaviorDisabled: boolean;
	};
	onShortcutChange: (actionId: string, shortcut: string) => void;
	onShortcutReset: (actionId: string) => void;
	onResetAll: () => void;
	onQuickPanelTriggerChange: (trigger: QuickPanelTrigger) => void;
	onQuickPanelBehaviorChange: (behavior: QuickPanelBehavior) => void;
}

export function useShortcutsSettingsModel(): ShortcutsSettingsModel {
	const { t } = useTranslation("settings");
	const [customShortcuts, setCustomShortcuts] = useState<ShortcutBindings>({});
	const [trigger, setTrigger] = useState<QuickPanelTrigger>("none");
	const [behavior, setBehavior] = useState<QuickPanelBehavior>("foreground");

	const isMac = navigator.platform.toUpperCase().includes("MAC");
	const modGlyph = isMac ? "⌘" : "Ctrl";
	const altGlyph = isMac ? "⌥" : "Alt";

	useEffect(() => {
		void loadShortcutBindings().then(setCustomShortcuts);
		const unsubShortcuts = window.vetta.config.onShortcutsChanged((event) => {
			setCustomShortcuts(event.bindings ?? {});
		});
		void window.vetta.config.get().then((config) => {
			const qp = config.quickPanel;
			setTrigger(qp?.trigger === "mod" || qp?.trigger === "alt" || qp?.trigger === "shift" ? qp.trigger : "none");
			setBehavior(qp?.postSendBehavior === "background" ? "background" : "foreground");
		});
		return unsubShortcuts;
	}, []);

	const persistQuickPanel = useCallback(
		async (patch: { trigger?: QuickPanelTrigger; postSendBehavior?: QuickPanelBehavior }): Promise<boolean> => {
			try {
				await window.vetta.config.set({ quickPanel: patch });
				await window.vetta.quickPanel.reloadHotkey();
				return true;
			} catch (error) {
				showToast({
					variant: "error",
					title: t("shortcutSaveFailed"),
					message: error instanceof Error ? error.message : String(error),
				});
				return false;
			}
		},
		[t],
	);

	const persistBindings = useCallback(
		async (next: ShortcutBindings): Promise<void> => {
			try {
				await saveShortcutBindings(next);
				setCustomShortcuts(next);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showToast({
					variant: "error",
					title: t("shortcutSaveFailed"),
					message: message.startsWith("Shortcut conflict:") ? t("shortcutSaveFailed") : message,
				});
			}
		},
		[t],
	);

	const handleShortcutChange = useCallback(
		(actionId: string, shortcut: string) => {
			void persistBindings({ ...customShortcuts, [actionId]: shortcut });
			recordSettingsUsage({ tab: "shortcuts", action: "changed", target: "shortcut" });
		},
		[customShortcuts, persistBindings],
	);

	const handleShortcutReset = useCallback(
		(actionId: string) => {
			const next = { ...customShortcuts };
			delete next[actionId as keyof typeof next];
			void persistBindings(next);
			recordSettingsUsage({ tab: "shortcuts", action: "reset", target: "shortcut" });
		},
		[customShortcuts, persistBindings],
	);

	const handleResetAll = useCallback(() => {
		void persistBindings({});
		recordSettingsUsage({ tab: "shortcuts", action: "reset", target: "all-shortcuts" });
	}, [persistBindings]);

	const handleTriggerChange = useCallback(
		(value: QuickPanelTrigger) => {
			void persistQuickPanel({ trigger: value }).then((saved) => {
				if (saved) setTrigger(value);
			});
			recordSettingsUsage({ tab: "shortcuts", action: "changed", target: "quick-panel-trigger", value });
		},
		[persistQuickPanel],
	);

	const handleBehaviorChange = useCallback(
		(value: QuickPanelBehavior) => {
			void persistQuickPanel({ postSendBehavior: value }).then((saved) => {
				if (saved) setBehavior(value);
			});
			recordSettingsUsage({ tab: "shortcuts", action: "changed", target: "quick-panel-behavior", value });
		},
		[persistQuickPanel],
	);

	const shortcutActions = useMemo(
		() =>
			SHORTCUT_ACTIONS.map((action) => ({
				id: action.id,
				label: t(action.labelKey),
				description: t(action.descriptionKey),
				effectiveShortcut: getEffectiveShortcut(action.id, customShortcuts),
				isDefault: !customShortcuts[action.id],
			})),
		[customShortcuts, t],
	);

	const triggerDescription =
		trigger !== "none" && isMac ? t("quickPanelTriggerHintMac") : t("quickPanelTriggerDescription");

	return {
		title: t("shortcuts"),
		resetAllLabel: t("resetAllShortcuts"),
		shortcutHint: t("shortcutHint"),
		shortcutPlaceholder: t("shortcutPlaceholder"),
		resetLabel: t("reset"),
		globalSectionTitle: t("section_shortcuts-global"),
		shortcutActions,
		quickPanel: {
			trigger,
			behavior,
			sectionTitle: t("section_shortcuts-quickpanel"),
			triggerTitle: t("quickPanelTrigger"),
			triggerDescription,
			behaviorTitle: t("quickPanelBehavior"),
			behaviorDescription: t("quickPanelBehaviorDescription"),
			triggerOptions: [
				{ value: "none", label: t("quickPanelTriggerNone") },
				{ value: "mod", label: t("quickPanelTriggerDoubleTap", { key: modGlyph }) },
				{ value: "alt", label: t("quickPanelTriggerDoubleTap", { key: altGlyph }) },
				{ value: "shift", label: t("quickPanelTriggerDoubleTap", { key: "⇧" }) },
			],
			behaviorOptions: [
				{ value: "foreground", label: t("quickPanelBehaviorForeground") },
				{ value: "background", label: t("quickPanelBehaviorBackground") },
			],
			behaviorDisabled: trigger === "none",
		},
		onShortcutChange: handleShortcutChange,
		onShortcutReset: handleShortcutReset,
		onResetAll: handleResetAll,
		onQuickPanelTriggerChange: handleTriggerChange,
		onQuickPanelBehaviorChange: handleBehaviorChange,
	};
}
