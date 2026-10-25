// 主进程 i18next 实例：用于原生菜单（tray / pet 右键）与系统通知文案。
// 与 renderer 共享同一套 catalog（src/shared/i18n），但这里不接 react，defaultNS=main。
// 语言偏好真相源是 ~/.567agent/desktop-config.json 的 language 字段（见 ADR-0031），
// 取值 system | zh | en；initAppLanguage() 在 app.whenReady 内、建任何菜单之前同步调用。

import { app } from "electron";
import {
	type AppLanguage,
	DEFAULT_LANGUAGE,
	DEFAULT_LANGUAGE_PREFERENCE,
	isLanguagePreference,
	type LanguagePreference,
	type LanguageState,
	resolveAppLanguage,
} from "../../shared/i18n/resources.js";
import { readConfigSync } from "../config/desktop-config-store.js";

import { changeMainLanguage, initializeMainMessages } from "./messages.js";

export { mainT } from "./messages.js";

let currentPreference: LanguagePreference = DEFAULT_LANGUAGE_PREFERENCE;
let currentLanguage: AppLanguage = DEFAULT_LANGUAGE;

/** 读 OS 系统 locale（优先 getSystemLocale，回退 getLocale）。 */
export function readSystemLocale(): string {
	try {
		const system = typeof app.getSystemLocale === "function" ? app.getSystemLocale() : "";
		if (system) return system;
	} catch {
		// ignore
	}
	try {
		return app.getLocale() || "";
	} catch {
		return "";
	}
}

function readStoredPreference(): LanguagePreference {
	const stored = readConfigSync().language;
	return isLanguagePreference(stored) ? stored : DEFAULT_LANGUAGE_PREFERENCE;
}

/**
 * 同步初始化主进程语言：
 * - desktop-config.language = system | 缺省 → 跟随系统 locale
 * - zh / en → 固定语言
 */
export function initAppLanguage(): void {
	currentPreference = readStoredPreference();
	currentLanguage = resolveAppLanguage(currentPreference, readSystemLocale());
	initializeMainMessages(currentLanguage);
}

export function getLanguagePreference(): LanguagePreference {
	return currentPreference;
}

export function getAppLanguage(): AppLanguage {
	return currentLanguage;
}

export function getLanguageState(): LanguageState {
	return { preference: currentPreference, language: currentLanguage };
}

/**
 * 应用语言偏好：更新 preference + 解析后的 AppLanguage，并切换 main i18n。
 * 持久化与广播由 ipc/i18n.ts 负责。
 */
export function applyLanguagePreference(preference: LanguagePreference): LanguageState {
	currentPreference = preference;
	currentLanguage = resolveAppLanguage(preference, readSystemLocale());
	changeMainLanguage(currentLanguage);
	return getLanguageState();
}
