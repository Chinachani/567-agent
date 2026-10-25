import i18next from "i18next";
import { type AppLanguage, FALLBACK_LANGUAGE, NAMESPACES, resources } from "../../shared/i18n/resources.js";

const mainI18n = i18next.createInstance();

/** Shared by Electron and the desktop's Node RPC host. No OS APIs are loaded here. */
export function initializeMainMessages(language: AppLanguage): void {
	void mainI18n.init({
		resources,
		lng: language,
		fallbackLng: FALLBACK_LANGUAGE,
		ns: NAMESPACES,
		defaultNS: "main",
		initAsync: false,
		interpolation: { escapeValue: false },
	});
}

export function changeMainLanguage(language: AppLanguage): void {
	void mainI18n.changeLanguage(language);
}

export function mainT(key: string, options?: Record<string, unknown>): string {
	// i18next rebinds t during initialization; resolve it at call time.
	const t = mainI18n.t as unknown as (key: string, options?: Record<string, unknown>) => string;
	return t(key, options);
}
