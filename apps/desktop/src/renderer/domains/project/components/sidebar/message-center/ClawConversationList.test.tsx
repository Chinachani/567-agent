// @vitest-environment jsdom
import { defaultImConversationCwdAtom } from "@shared/store/atoms";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import { expect, it, vi } from "vitest";
import { ClawConversationList } from "./ClawConversationList";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it("lists readable Claw sessions and opens them in the read-only viewer", async () => {
	const cwd = "/claw";
	const path = "/claw/.567agent/sessions/recent.conversation.jsonl";
	const listSessions = vi.fn(async () => [
		{ path: "/private", name: "Hidden session", modifiedAt: 3, access: { readHistory: false } },
		{ path: "/claw/older", name: "Older chat", modifiedAt: 1, access: { readHistory: true } },
		{ path, name: "Recent chat", modifiedAt: 2, access: { readHistory: true } },
	]);
	vi.stubGlobal("agent567", { session: { listSessions }, im: { onSessionChanged: () => () => {} } });
	const store = createStore();
	store.set(defaultImConversationCwdAtom, cwd);
	const onOpen = vi.fn();
	try {
		render(
			<Provider store={store}>
				<ClawConversationList onOpen={onOpen} />
			</Provider>,
		);
		await screen.findByRole("button", { name: /Recent chat/ });
		expect(listSessions).toHaveBeenCalledWith(cwd);
		const rows = within(screen.getByRole("list")).getAllByRole("button");
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain("Recent chat");
		await userEvent.click(rows[0]);
		expect(navigate).toHaveBeenCalledWith({ to: "/viewer/$path", params: { path: encodeURIComponent(path) } });
		expect(onOpen).toHaveBeenCalledOnce();
	} finally {
		vi.unstubAllGlobals();
	}
});
