import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";
import project from "../../../../../../shared/i18n/locales/zh/project.json";
// @vitest-environment jsdom

import { updaterRestartDialogOpenAtom, updaterStateAtom } from "@shared/store/atoms";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it } from "vitest";
import { useSidebarUpdateBannerModel } from "./useSidebarUpdateBannerModel";

afterEach(cleanup);
it("requests restart confirmation and obeys the reminder preference without hiding settings state", async () => {
	const instance = createInstance();
	await instance.use(initReactI18next).init({ lng: "zh", resources: { zh: { project } }, defaultNS: "project" });
	const store = createStore();
	store.set(updaterStateAtom, { phase: "ready", currentVersion: "1.5.0", latestVersion: "1.5.1" });
	const { result } = renderHook(useSidebarUpdateBannerModel, {
		wrapper: ({ children }) => (
			<I18nextProvider i18n={instance}>
				<Provider store={store}>{children}</Provider>
			</I18nextProvider>
		),
	});
	act(() => result.current!.onRestart());
	expect(store.get(updaterRestartDialogOpenAtom)).toBe(true);
	act(() => store.set(updaterStateAtom, { ...store.get(updaterStateAtom), showReminder: false }));
	expect(result.current).toBeNull();
	expect(store.get(updaterStateAtom).phase).toBe("ready");
});
