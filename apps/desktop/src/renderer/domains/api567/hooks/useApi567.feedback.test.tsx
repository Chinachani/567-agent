/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { initI18n } from "@shared/i18n";
import { dismissToast, toastsAtom } from "@shared/store/toast-atoms";
import i18n from "i18next";
import { getDefaultStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { afterEach, beforeAll, expect, it } from "vitest";
import { useApi567 } from "./useApi567";

beforeAll(async () => { initI18n(); await i18n.changeLanguage("zh"); });
afterEach(() => { cleanup(); for (const toast of getDefaultStore().get(toastsAtom)) dismissToast(toast.id); });
const wrapper = ({ children }: PropsWithChildren) => <Provider>{children}</Provider>;

it("reports business rejection and transport failure from account operations", async () => {
	Object.assign(window, { agent567: { api567: {
		getStatus: async () => ({ isLoggedIn: false }), onStatusChanged: () => () => {},
		removeGroup: async () => ({ success: false, message: "分组仍在使用中" }),
		refreshQuota: async () => { throw new Error("offline"); },
		refreshGroups: async () => ({ success: false }),
	} } });
	const hook = renderHook(useApi567, { wrapper });
	await waitFor(() => expect(hook.result.current.initialCheckDone).toBe(true));
	await act(async () => { await hook.result.current.removeGroup("chat"); });
	expect(getDefaultStore().get(toastsAtom).at(-1)).toMatchObject({ variant: "error", message: "分组仍在使用中" });
	await act(async () => { await hook.result.current.refreshQuota(true); });
	expect(getDefaultStore().get(toastsAtom).at(-1)?.message).toBe("刷新余额失败，请重试。");
	await act(async () => { await hook.result.current.refreshGroups(); });
	expect(getDefaultStore().get(toastsAtom).at(-1)?.message).toBe("无法读取模型分组，请重试。");
});
