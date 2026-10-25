/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { initI18n } from "@shared/i18n";
import i18n from "i18next";
import { createStore, Provider } from "jotai";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { api567StatusAtom, api567InitialCheckDoneAtom } from "../../api567/store/api567-atoms";
import { API567_FALLBACK_ROUTES } from "../../../../shared/service-routes";
import { Api567GroupsSection } from "./Api567GroupsSection";

beforeAll(async () => { initI18n(); await i18n.changeLanguage("zh"); });
afterEach(cleanup);

it("finishes an empty group load, reports a failed retry, then shows groups on a successful retry", async () => {
	const getAvailableGroups = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ "chat GPT": { desc: "Model group", ratio: .2 } });
	const status = { isLoggedIn: true, username: "User", loginUsername: "user", quota: 1, availableGroups: {}, serviceRoute: "germany" as const };
	Object.assign(window, { agent567: { api567: { getStatus: async () => status, getAvailableGroups,
		onStatusChanged: () => () => {}, refreshServiceRoutes: async () => ({ routes: API567_FALLBACK_ROUTES, source: "builtin" }),
	} } });
	const store = createStore(); store.set(api567StatusAtom, status); store.set(api567InitialCheckDoneAtom, true);
	const user = userEvent.setup();
	render(<Provider store={store}><Api567GroupsSection config={{ providers: {} }} /></Provider>);
	expect(await screen.findByText("当前账号暂无可用分组。")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "重新读取" }));
	expect(await screen.findByText("无法读取模型分组，请重试。")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "重新读取" }));
	expect(await screen.findByText("chat GPT")).toBeTruthy();
	expect(screen.queryByText("正在读取模型分组…")).toBeNull();
});
